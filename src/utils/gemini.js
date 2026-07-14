const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

const CARD_FIELD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    company: { type: 'string' },
    jobTitle: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    website: { type: 'string' },
    address: { type: 'string' },
  },
  required: ['name', 'company', 'jobTitle', 'phone', 'email', 'website', 'address'],
};

function isGeminiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function isRetryableError(err) {
  // The SDK throws with the raw API error JSON as the message on failure responses.
  let code;
  let status;
  try {
    ({
      error: { code, status },
    } = JSON.parse(err.message));
  } catch {
    return false;
  }
  // 503/UNAVAILABLE = model overloaded, 429/RESOURCE_EXHAUSTED = rate limited — both are
  // transient and worth a retry; anything else (bad request, auth, etc.) would just fail again.
  return code === 503 || status === 'UNAVAILABLE' || code === 429 || status === 'RESOURCE_EXHAUSTED';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads one or two photographs of a business card (front, and optionally back) and returns
 * structured contact fields. `images` is an array of { buffer, mimeType } — a second entry is
 * the back of the same card, which the model combines into one set of fields (e.g. an address
 * printed only on the back still ends up in the result).
 */
async function extractCardFields(images) {
  if (!isGeminiEnabled()) {
    const err = new Error('AI card scanning is not configured. Add GEMINI_API_KEY to server/.env to enable it.');
    err.status = 503;
    throw err;
  }

  const isTwoSided = images.length > 1;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const request = {
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              isTwoSided
                ? 'These images are photographs of the front and back of the same business card. Read both and extract one combined set of contact details — information may be split across the two sides (e.g. the address printed only on the back).'
                : 'This image is a photograph of a business card. Read it and extract the contact details.',
              'If a field is not present or not legible on either side, return an empty string for it — never guess or invent a value.',
              'If more than one phone number is shown (e.g. primary and secondary), include all of them in "phone", separated by " / ".',
              'Return the company name as printed (including any stylized logo text), not the job title or tagline.',
              'Transcribe the email address and website exactly as printed, character for character, even if part of it looks like a typo or misspelling (e.g. a missing letter) — do NOT "correct" or normalize it, since these values must work as-is to actually reach the business.',
            ].join(' '),
          },
          ...images.map((img) => ({
            inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.buffer.toString('base64') },
          })),
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: CARD_FIELD_SCHEMA,
    },
  };

  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [500, 1500, 3000];
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent(request);
      const text = response.text;
      if (!text) throw new Error('AI card scan returned no content');
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1 && isRetryableError(err)) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      break;
    }
  }

  const err = new Error(
    isRetryableError(lastError)
      ? "The AI card reader is temporarily overloaded. Please try again in a moment, or fill the fields in manually."
      : 'Could not read the card. Please try again, or fill the fields in manually.'
  );
  err.status = 503;
  throw err;
}

module.exports = { isGeminiEnabled, extractCardFields };
