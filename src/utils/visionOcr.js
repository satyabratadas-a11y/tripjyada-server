// Dedicated OCR (Google Cloud Vision's TEXT_DETECTION) — the same category of tech behind Google
// Lens/Photos text scanning, not a generative model reasoning over the image. Sub-second on
// high-throughput infrastructure, and not subject to the "model overloaded" behavior an LLM vision
// call has. Separate product/API key from Gemini's Generative Language API — see server/.env.example.
const VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;

function isVisionEnabled() {
  return Boolean(VISION_API_KEY);
}

/** Extracts raw text from one image. Returns '' if Vision found no text at all. */
async function detectText({ buffer, mimeType }) {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: buffer.toString('base64') },
          features: [{ type: 'TEXT_DETECTION' }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vision API request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const result = data.responses?.[0];
  if (result?.error) throw new Error(result.error.message || 'Vision API returned an error');
  return result?.fullTextAnnotation?.text || '';
}

/**
 * OCRs every image (front, optionally back) and returns one raw-text string per image, in the
 * same order — or null if Vision isn't configured, or any image's OCR call fails, so the caller
 * can fall back to the slower-but-still-working direct-image Gemini path instead of failing the
 * whole scan over what should be a pure speed optimization.
 */
async function extractTextFromImages(images) {
  if (!isVisionEnabled()) return null;
  try {
    const texts = await Promise.all(images.map(detectText));
    if (texts.every((t) => !t.trim())) return null;
    return texts;
  } catch (err) {
    console.log(`[vision] OCR failed (${err.message}) — falling back to a direct Gemini vision call`);
    return null;
  }
}

module.exports = { isVisionEnabled, extractTextFromImages };
