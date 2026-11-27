/**
 * Utility to extract inline EPUB illustration image URLs and clean text from segments.
 * Segments may contain `seg.image_url` or `[IMAGE:/static/covers/...]` in `seg.text`.
 */
export function parseSegmentImage(seg) {
  if (!seg) return { imgUrl: null, cleanText: '' };
  let imgUrl = seg.image_url || null;
  let cleanText = seg.text || '';

  if (typeof cleanText === 'string') {
    const match = cleanText.match(/\[IMAGE:(.*?)\]/);
    if (match) {
      if (!imgUrl) {
        imgUrl = match[1].trim();
      }
      cleanText = cleanText.replace(/\[IMAGE:.*?\]/g, '').trim();
    }
  }

  return { imgUrl, cleanText };
}

/**
 * Fallback handler for cover and chapter illustration URLs so `/static/covers/...`
 * and `/covers/...` seamlessly cross-retry before hiding/falling back.
 */
export function handleCoverImageError(e, onFinalFailure) {
  const img = e?.currentTarget;
  if (!img) return;
  const src = img.getAttribute('src') || '';
  if (!img.dataset.fallbackTried) {
    img.dataset.fallbackTried = '1';
    if (src.startsWith('/static/covers/')) {
      img.src = src.replace('/static/covers/', '/covers/');
      return;
    }
    if (src.startsWith('/covers/')) {
      img.src = src.replace('/covers/', '/static/covers/');
      return;
    }
  }
  img.style.display = 'none';
  if (typeof onFinalFailure === 'function') {
    onFinalFailure(img);
  }
}
