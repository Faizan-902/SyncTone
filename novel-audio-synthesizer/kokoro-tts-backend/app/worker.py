"""Headless Python Background Worker Daemon for Kokoro Neural TTS Synthesis.

Claims synthesis jobs from PostgreSQL using row-level locking (FOR UPDATE SKIP LOCKED),
synthesizes neural audio segments, and exports gapless audio.
Zero web/FastAPI code — purely an offline event/queue worker daemon.
"""

import os
import sys
import time
import signal
import asyncio
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is always on sys.path for direct script execution
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select, update, func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models import SynthesisJob, Chapter, Character, Voice, ChapterSynthesisJobTarget, NovelProfileJobTarget
from app.core.logger import get_logger

logger = get_logger("synctone.worker")

try:
    from app.engine.tts_engine import TTSEngine
    from app.engine.audio_stitcher import AudioStitcher
except ImportError as e:
    TTSEngine = None
    AudioStitcher = None
    logger.warning(f"Audio/TTS engine dependencies not fully installed ({e}). Running in queue worker mode.")

RUNNING = True


def handle_shutdown(signum, frame):
    """Graceful shutdown handler."""
    global RUNNING
    logger.info(f"Received signal {signum}. Shutting down worker gracefully...")
    RUNNING = False


signal.signal(signal.SIGINT, handle_shutdown)
signal.signal(signal.SIGTERM, handle_shutdown)


class HeadlessWorker:
    """Worker daemon that claims and executes synthesis jobs."""

    def __init__(self, worker_id: str = "worker-1"):
        self.worker_id = worker_id
        self.tts = TTSEngine() if TTSEngine is not None else None
        self.stitcher = AudioStitcher() if AudioStitcher is not None else None

    def claim_next_job(self, db: Session) -> SynthesisJob | None:
        """Atomically claim the next queued job using FOR UPDATE SKIP LOCKED."""
        now = datetime.now(timezone.utc)
        stmt = (
            select(SynthesisJob)
            .where(
                SynthesisJob.status == "queued",
                SynthesisJob.job_type.in_(["synthesize_chapter", "profile_novel"]),
                SynthesisJob.run_after <= now,
                SynthesisJob.attempts < SynthesisJob.max_attempts,
            )
            .order_by(SynthesisJob.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        job = db.execute(stmt).scalars().first()
        if job:
            job.status = "processing"
            job.worker_id = self.worker_id
            job.locked_at = now
            job.attempts += 1
            db.commit()
            db.refresh(job)
            logger.info(f"[{self.worker_id}] Claimed job {job.id} (type: {job.job_type})")
        return job

    async def process_job(self, job: SynthesisJob, db: Session):
        """Execute speech synthesis for the claimed job."""
        try:
            target_chapter_id = job.chapter_id
            if not target_chapter_id and job.job_type == "synthesize_chapter":
                target = await asyncio.to_thread(
                    db.scalar,
                    select(ChapterSynthesisJobTarget).where(ChapterSynthesisJobTarget.job_id == job.id),
                )
                target_chapter_id = target.chapter_id if target else None

            logger.info(f"[{self.worker_id}] Processing job {job.id} (chapter: {target_chapter_id})...")
            job.progress_pct = 20.0
            await asyncio.to_thread(db.commit)

            if self.tts is None or self.stitcher is None:
                raise RuntimeError("TTS engine or audio stitcher is unavailable in Python worker")
            if not target_chapter_id:
                raise ValueError(f"Synthesis job {job.id} has no target chapter_id")

            model_status = await self.tts.check_model_available()
            if not (model_status.get("model_exists") and model_status.get("voices_exists")):
                raise FileNotFoundError(
                    f"Kokoro model files unavailable: {model_status.get('model_path')}"
                )

            segment_loader = getattr(self, "get_chapter_segments", None)
            if not callable(segment_loader):
                raise RuntimeError(
                    "Python worker has no configured chapter segment source (use Node synthesis pipeline or configure get_chapter_segments)"
                )

            segments = await segment_loader(target_chapter_id)
            if not segments:
                raise ValueError(f"No segments found for chapter {target_chapter_id}")

            stitched_inputs = []
            total = len(segments)
            for idx, seg in enumerate(segments):
                seg_id = seg.get("segment_id", idx) if isinstance(seg, dict) else getattr(seg, "segment_id", idx)
                seg_text = seg.get("text", "") if isinstance(seg, dict) else getattr(seg, "text", "")
                voice_id = (
                    seg.get("assigned_voice_id") or seg.get("voice_id")
                    if isinstance(seg, dict)
                    else getattr(seg, "assigned_voice_id", None)
                ) or "af_heart"
                speaker_name = (
                    seg.get("speaker_name") or "Narrator"
                    if isinstance(seg, dict)
                    else getattr(seg, "speaker_name", None) or "Narrator"
                )
                samples, _duration_ms = await self.tts.synthesize_segment(
                    text=seg_text,
                    voice_id=voice_id,
                )
                stitched_inputs.append(
                    {
                        "segment_id": seg_id,
                        "voice_id": voice_id,
                        "speaker_name": speaker_name,
                        "pcm_samples": samples,
                    }
                )
                job.progress_pct = 20.0 + (60.0 * (idx + 1) / total)
                await asyncio.to_thread(db.commit)

            from pathlib import Path
            from app.core.config import settings

            output_dir = settings.resolve_path(settings.AUDIO_OUTPUT_DIR)
            manifest = await asyncio.to_thread(
                self.stitcher.stitch,
                stitched_inputs,
                Path(output_dir),
                str(target_chapter_id),
            )

            def _complete_job_and_chapter():
                chapter = db.get(Chapter, target_chapter_id)
                if chapter is not None:
                    chapter.status = "completed"
                    chapter.swift_audio_object = manifest.audio_url
                    chapter.total_duration_ms = int(manifest.total_duration_ms)
                job.progress_pct = 100.0
                job.status = "completed"
                job.completed_at = datetime.now(timezone.utc)
                db.commit()

            await asyncio.to_thread(_complete_job_and_chapter)
            logger.info(f"[{self.worker_id}] Successfully completed job {job.id}")
        except Exception as e:
            logger.error(f"[{self.worker_id}] Job {job.id} failed: {e}")
            try:
                await asyncio.to_thread(db.rollback)
                job.status = "failed"
                job.error_message = str(e)
                await asyncio.to_thread(db.commit)
            except Exception as commit_err:
                logger.error(f"[{self.worker_id}] Failed to mark job {job.id} failed: {commit_err}")
                try:
                    await asyncio.to_thread(db.rollback)
                except Exception:
                    pass

    async def run(self, poll_interval_sec: float = 3.0):
        """Main daemon loop."""
        logger.info(f"[{self.worker_id}] Headless Worker started. Polling interval: {poll_interval_sec}s")
        while RUNNING:
            with SessionLocal() as db:
                try:
                    job = self.claim_next_job(db)
                    if job:
                        await self.process_job(job, db)
                    else:
                        await asyncio.sleep(poll_interval_sec)
                except Exception as e:
                    logger.error(f"[{self.worker_id}] Error in worker loop: {e}")
                    await asyncio.sleep(poll_interval_sec)

        logger.info(f"[{self.worker_id}] Headless Worker stopped cleanly.")


def main():
    worker_id = os.getenv("WORKER_ID", f"worker-{os.getpid()}")
    interval = float(os.getenv("WORKER_POLL_INTERVAL_SEC", "3.0"))
    daemon = HeadlessWorker(worker_id=worker_id)
    asyncio.run(daemon.run(poll_interval_sec=interval))


if __name__ == "__main__":
    main()
