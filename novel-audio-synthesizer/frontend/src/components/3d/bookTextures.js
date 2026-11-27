import * as THREE from 'three';

/**
 * Measure text width with a safe fallback when running in stubbed/headless canvas contexts.
 */
function measureTextWidth(ctx, text, fontSize) {
  if (typeof ctx.measureText === 'function') {
    const measured = ctx.measureText(text)?.width;
    if (typeof measured === 'number' && measured > 0) {
      return measured;
    }
  }
  return text.length * fontSize * 0.62;
}

/**
 * Fit a single line of text within maxWidth by scaling font size down first,
 * then truncating with an ellipsis if it still exceeds maxWidth.
 */
function fitSingleLineText(ctx, rawText, maxWidth, fontFamily, weight, maxFontSize, minFontSize) {
  const text = String(rawText || '').trim();
  let fontSize = maxFontSize;

  while (fontSize > minFontSize) {
    ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
    if (measureTextWidth(ctx, text, fontSize) <= maxWidth) {
      return { text, fontSize };
    }
    fontSize -= 2;
  }

  ctx.font = `${weight} ${minFontSize}px ${fontFamily}`;
  if (measureTextWidth(ctx, text, minFontSize) <= maxWidth) {
    return { text, fontSize: minFontSize };
  }

  let truncated = text;
  while (truncated.length > 1 && measureTextWidth(ctx, `${truncated}…`, minFontSize) > maxWidth) {
    truncated = truncated.slice(0, -1).trimEnd();
  }
  return { text: `${truncated}…`, fontSize: minFontSize };
}

/**
 * Wrap text into centered lines within maxWidth, scaling font size down if needed
 * so the wrapped block never exceeds maxLines.
 */
function fitWrappedLines(ctx, rawText, maxWidth, fontFamily, weight, maxFontSize, minFontSize, maxLines) {
  const words = String(rawText || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { lines: ['SYNCTONE CLASSIC'], fontSize: maxFontSize };
  }

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (measureTextWidth(ctx, candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    const anyTooWide = lines.some((l) => measureTextWidth(ctx, l, fontSize) > maxWidth);
    if (!anyTooWide && lines.length <= maxLines) {
      return { lines, fontSize };
    }
  }

  ctx.font = `${weight} ${minFontSize}px ${fontFamily}`;
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (measureTextWidth(ctx, candidate, minFontSize) <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  if (lines.length > maxLines) {
    const clamped = lines.slice(0, maxLines);
    let last = clamped[maxLines - 1];
    while (last.length > 1 && measureTextWidth(ctx, `${last}…`, minFontSize) > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    clamped[maxLines - 1] = `${last}…`;
    return { lines: clamped, fontSize: minFontSize };
  }

  return { lines, fontSize: minFontSize };
}

/**
 * Draw subtle leatherette grain onto a canvas context.
 */
function drawLeatherGrain(ctx, width, height, count = 3000, maxAlphaByte = 14) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const v = Math.random() * maxAlphaByte;
    ctx.fillStyle = `rgba(255, 255, 255, ${v / 255})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
}

/**
 * Procedural Page Edge Texture
 * Simulates thousands of paper leaf edges pressed together in a hardcover book block.
 */
export function createPageEdgeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  // Archival cream base
  ctx.fillStyle = '#F4EDE0';
  ctx.fillRect(0, 0, 512, 128);

  // Subtle paper page layers (hundreds of thin striations)
  ctx.lineWidth = 1;
  for (let y = 0; y < 128; y += 1.5) {
    const alpha = 0.08 + Math.random() * 0.12;
    ctx.strokeStyle = `rgba(168, 150, 130, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  // Edge shading gradient (darker near the hinge/binding)
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
  grad.addColorStop(0.08, 'rgba(0, 0, 0, 0.04)');
  grad.addColorStop(0.92, 'rgba(0, 0, 0, 0.04)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural Spine Texture for a given novel
 * Generates an authentic embossed cloth/leather spine with gold foil accents,
 * strictly non-overlapping vertical title, author, and volume number.
 */
export function createSpineTexture(novel, volumeNumber = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  // Rich noir leatherette base
  ctx.fillStyle = '#141418';
  ctx.fillRect(0, 0, 160, 1024);

  // Subtle leather noise grain
  drawLeatherGrain(ctx, 160, 1024, 4000, 15);

  // Curvature shading: darker at the edges, highlight down the spine center
  const curveGrad = ctx.createLinearGradient(0, 0, 160, 0);
  curveGrad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  curveGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.08)');
  curveGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.16)');
  curveGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.08)');
  curveGrad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
  ctx.fillStyle = curveGrad;
  ctx.fillRect(0, 0, 160, 1024);

  // Gold foil ribbing / headbands (top and bottom)
  const drawRibbon = (y) => {
    ctx.fillStyle = '#C5A059';
    ctx.fillRect(16, y, 128, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(16, y, 128, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(16, y + 3, 128, 1);
  };

  drawRibbon(40);
  drawRibbon(50);
  drawRibbon(974);
  drawRibbon(984);

  // Volume badge at top (y = 84..110)
  ctx.save();
  ctx.fillStyle = '#C5A059';
  ctx.font = 'bold 20px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`VOL. ${String(volumeNumber).padStart(2, '0')}`, 80, 104, 128);
  ctx.restore();

  // Subtle gold divider separating volume badge from title zone
  ctx.fillStyle = 'rgba(197, 160, 89, 0.45)';
  ctx.fillRect(52, 132, 56, 2);

  // Vertical Novel Title — bounded strictly within [180, 620] (center 400, maxWidth 440)
  const titleMaxWidth = 440;
  const rawTitle = (novel?.title || 'SYNCTONE CLASSIC').toUpperCase();
  ctx.save();
  ctx.translate(80, 400);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#F2F2F5';
  const fittedTitle = fitSingleLineText(
    ctx,
    rawTitle,
    titleMaxWidth,
    '"Inter", sans-serif',
    'bold',
    28,
    14
  );
  ctx.font = `bold ${fittedTitle.fontSize}px "Inter", sans-serif`;
  ctx.fillText(fittedTitle.text, 0, 8, titleMaxWidth);
  ctx.restore();

  // Gold foil divider between title zone and author zone (y = 668)
  ctx.fillStyle = 'rgba(197, 160, 89, 0.55)';
  ctx.fillRect(64, 668, 32, 2);

  // Author near bottom — bounded strictly within [696, 898] (center 797, maxWidth 190)
  const authorMaxWidth = 190;
  const rawAuthor = (novel?.author_username || novel?.author || 'AUTHOR').toUpperCase();
  ctx.save();
  ctx.translate(80, 797);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#A9A9B2';
  const fittedAuthor = fitSingleLineText(
    ctx,
    rawAuthor,
    authorMaxWidth,
    '"JetBrains Mono", monospace',
    '600',
    18,
    12
  );
  ctx.font = `600 ${fittedAuthor.fontSize}px "JetBrains Mono", monospace`;
  ctx.fillText(fittedAuthor.text, 0, 6, authorMaxWidth);
  ctx.restore();

  // SyncTone emblem imprint at very bottom (y = 942)
  ctx.save();
  ctx.fillStyle = '#C5A059';
  ctx.font = 'bold 15px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SYNCTONE', 80, 942, 128);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural Typographic Front Cover Texture
 * Clean editorial hardcover fallback when novel.cover_object is missing or fails to load.
 * Matches the 2:3 front cover aspect ratio (512x768) with horizontal wrapped typography.
 */
export function createFrontCoverTexture(novel, volumeNumber = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.needsUpdate = true;
    return fallback;
  }

  // Deep noir hardcover base with subtle radial studio highlight
  const bgGrad = ctx.createRadialGradient(256, 260, 40, 256, 384, 460);
  bgGrad.addColorStop(0, '#1D1D24');
  bgGrad.addColorStop(0.6, '#131318');
  bgGrad.addColorStop(1, '#0B0B0E');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 768);

  // Subtle cloth/leather grain
  drawLeatherGrain(ctx, 512, 768, 3200, 12);

  // Spine hinge crease shading along the left edge
  const hingeGrad = ctx.createLinearGradient(0, 0, 32, 0);
  hingeGrad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  hingeGrad.addColorStop(0.4, 'rgba(255, 255, 255, 0.08)');
  hingeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hingeGrad;
  ctx.fillRect(0, 0, 32, 768);

  // Embossed inset double gold frame
  ctx.strokeStyle = 'rgba(197, 160, 89, 0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, 456, 712);

  ctx.strokeStyle = 'rgba(197, 160, 89, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(38, 38, 436, 692);

  // Volume & Edition header
  ctx.textAlign = 'center';
  ctx.fillStyle = '#C5A059';
  ctx.font = 'bold 13px "JetBrains Mono", monospace';
  ctx.fillText(
    `VOL. ${String(volumeNumber).padStart(2, '0')}  •  SYNCTONE EDITION`,
    256,
    82,
    396
  );

  // Genre / Tone tag
  const genreLabel = (novel?.global_tone || 'CANONICAL LITERATURE').toUpperCase();
  const fittedGenre = fitSingleLineText(
    ctx,
    genreLabel,
    380,
    '"JetBrains Mono", monospace',
    '600',
    11,
    9
  );
  ctx.fillStyle = '#A9A9B2';
  ctx.font = `600 ${fittedGenre.fontSize}px "JetBrains Mono", monospace`;
  ctx.fillText(fittedGenre.text, 256, 108, 380);

  // Upper ornamental rule + diamond
  ctx.strokeStyle = 'rgba(197, 160, 89, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(116, 136);
  ctx.lineTo(238, 136);
  ctx.moveTo(274, 136);
  ctx.lineTo(396, 136);
  ctx.stroke();

  ctx.fillStyle = '#C5A059';
  ctx.save();
  ctx.translate(256, 136);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();

  // Horizontal wrapped Novel Title
  const titleText = (novel?.title || 'SyncTone Classic').trim();
  const fittedTitle = fitWrappedLines(
    ctx,
    titleText,
    392,
    '"Newsreader", Georgia, serif',
    'bold',
    42,
    24,
    5
  );
  const lineHeight = Math.round(fittedTitle.fontSize * 1.26);
  const totalTitleHeight = fittedTitle.lines.length * lineHeight;
  const titleCenterY = 305;
  let currentY = titleCenterY - totalTitleHeight / 2 + fittedTitle.fontSize * 0.82;

  ctx.fillStyle = '#F2F2F5';
  ctx.font = `bold ${fittedTitle.fontSize}px "Newsreader", Georgia, serif`;
  for (const line of fittedTitle.lines) {
    ctx.fillText(line, 256, currentY, 396);
    currentY += lineHeight;
  }

  // Center emblem crest
  ctx.strokeStyle = 'rgba(197, 160, 89, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(256, 488, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#C5A059';
  ctx.beginPath();
  ctx.arc(256, 488, 4, 0, Math.PI * 2);
  ctx.fill();

  // Author credit line
  const rawAuthor = (novel?.author_username || novel?.author || 'SyncTone Author').toUpperCase();
  const fittedAuthor = fitSingleLineText(
    ctx,
    `BY ${rawAuthor}`,
    388,
    '"JetBrains Mono", monospace',
    '600',
    16,
    11
  );
  ctx.fillStyle = '#DCDCE2';
  ctx.font = `600 ${fittedAuthor.fontSize}px "JetBrains Mono", monospace`;
  ctx.fillText(fittedAuthor.text, 256, 558, 388);

  // Lower divider & Publisher colophon
  ctx.strokeStyle = 'rgba(197, 160, 89, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(96, 632);
  ctx.lineTo(416, 632);
  ctx.stroke();

  ctx.fillStyle = '#C5A059';
  ctx.font = 'bold 13px "JetBrains Mono", monospace';
  ctx.fillText('SYNCTONE CLASSICS', 256, 668, 380);

  const narratorLabel = (novel?.narrator_name || 'MULTI-VOICE AUDIOBOOK').toUpperCase();
  const fittedNarrator = fitSingleLineText(
    ctx,
    narratorLabel,
    380,
    '"JetBrains Mono", monospace',
    '500',
    10,
    9
  );
  ctx.fillStyle = '#8E8E98';
  ctx.font = `500 ${fittedNarrator.fontSize}px "JetBrains Mono", monospace`;
  ctx.fillText(fittedNarrator.text, 256, 692, 380);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural Back Cover Texture
 * Elegant dark hardcover back plate with debossed border, synopsis excerpt, and publisher colophon.
 */
export function createBackCoverTexture(novel) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  // Hardcover base
  ctx.fillStyle = '#111115';
  ctx.fillRect(0, 0, 512, 768);

  // Subtle linen / leather texture
  drawLeatherGrain(ctx, 512, 768, 3000, 12);

  // MinaLima / Noir Inset Gold Frame
  ctx.strokeStyle = 'rgba(197, 160, 89, 0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, 456, 712);

  ctx.strokeStyle = 'rgba(197, 160, 89, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(36, 36, 440, 696);

  // SyncTone Monogram / Crest
  ctx.fillStyle = '#C5A059';
  ctx.font = 'bold 24px "Newsreader", serif';
  ctx.textAlign = 'center';
  ctx.fillText('SYNCTONE CLASSICS', 256, 95);

  ctx.fillStyle = 'rgba(197, 160, 89, 0.5)';
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText('NEURAL DRAMATIZATION // MULTI-VOICE CAST', 256, 120);

  // Decorative divider
  ctx.strokeStyle = 'rgba(197, 160, 89, 0.35)';
  ctx.beginPath();
  ctx.moveTo(170, 140);
  ctx.lineTo(342, 140);
  ctx.stroke();

  // Synopsis text
  const synopsis =
    novel?.synopsis ||
    'An enduring literary masterpiece dynamically scored with generative ambient soundscapes, character voice assignment, and synchronized reading text.';
  ctx.fillStyle = '#D6D6DC';
  ctx.font = 'italic 17px "Newsreader", serif';
  ctx.textAlign = 'left';

  // Multi-line wrap
  const words = synopsis.split(' ');
  let line = '';
  let y = 185;
  const maxWidth = 400;
  for (let n = 0; n < words.length && y < 580; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, 56, y);
      line = words[n] + ' ';
      y += 28;
    } else {
      line = testLine;
    }
  }
  if (line && y < 580) {
    ctx.fillText(line, 56, y);
  }

  // Bottom Colophon & Barcode
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.moveTo(56, 610);
  ctx.lineTo(456, 610);
  ctx.stroke();

  // Simulated Barcode
  ctx.fillStyle = '#F2F2F5';
  let bx = 330;
  const barWidths = [2, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2, 3, 2, 1];
  for (const bw of barWidths) {
    ctx.fillRect(bx, 630, bw, 48);
    bx += bw + 2;
  }
  ctx.fillStyle = '#8E8E98';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('ISBN 978-0-SYNCTONE', 330, 692);

  ctx.fillText('EDITION: OFFICIAL CANONICAL', 56, 645);
  ctx.fillText('MASTERED BY SYNCTONE STUDIO', 56, 665);
  ctx.fillText('HIGH-FIDELITY SPATIAL AUDIO', 56, 685);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
