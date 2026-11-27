-- Enable Row-Level Security (RLS) on all tables in the public schema
-- and enforce security_invoker = true on all views in the public schema.
-- Resolves Supabase Security Advisories: rls_disabled_in_public & security_definer_view
-- Direct PostgREST API access (anon / authenticated) is blocked by default when RLS is enabled without permissive policies,
-- while table owners (postgres / neondb_owner) used by the Express backend bypass RLS automatically.

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.novels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.character_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.synthesis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.novel_profile_job_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chapter_synthesis_job_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.segment_audio_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.playback_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.playback_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.alembic_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.oauth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chapter_documents ENABLE ROW LEVEL SECURITY;

ALTER VIEW IF EXISTS public.v_synthesis_jobs SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_character_aliases SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_playback_history SET (security_invoker = true);
ALTER VIEW IF EXISTS public.reading_progress SET (security_invoker = true);

DO $$
DECLARE
    tbl RECORD;
    vw RECORD;
    has_anon BOOLEAN;
    has_authenticated BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_authenticated;

    FOR tbl IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
        IF has_anon THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl.tablename);
        END IF;
        IF has_authenticated THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl.tablename);
        END IF;
    END LOOP;

    FOR vw IN
        SELECT viewname
        FROM pg_views
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', vw.viewname);
        IF has_anon THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', vw.viewname);
        END IF;
        IF has_authenticated THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', vw.viewname);
        END IF;
    END LOOP;
END $$;
