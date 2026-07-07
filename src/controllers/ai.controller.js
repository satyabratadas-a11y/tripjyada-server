const ContentEntry = require('../models/ContentEntry');
const ContentPillar = require('../models/ContentPillar');
const { generateStructured } = require('../utils/anthropic');

const { CONTENT_FORMATS, PLATFORMS } = ContentEntry;

async function generateIdeas(req, res) {
  const { pillar, platform, count } = req.body;
  const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 15);

  const pillarDoc = pillar ? await ContentPillar.findOne({ _id: pillar, client: req.client._id }) : null;

  const result = await generateStructured({
    system:
      'You are a senior social media strategist for a digital marketing agency. Generate fresh, specific, non-generic content ideas for a client calendar. Avoid cliches and filler.',
    prompt: [
      `Client: ${req.client.name}`,
      req.client.industry ? `Industry: ${req.client.industry}` : '',
      req.client.businessType ? `Business type: ${req.client.businessType}` : '',
      pillarDoc ? `Content pillar: ${pillarDoc.name}${pillarDoc.description ? ` — ${pillarDoc.description}` : ''}` : '',
      platform ? `Target platform: ${platform}` : '',
      `Generate ${n} distinct content ideas as short, punchy one-line concepts.`,
    ]
      .filter(Boolean)
      .join('\n'),
    schema: {
      type: 'object',
      properties: { ideas: { type: 'array', items: { type: 'string' } } },
      required: ['ideas'],
      additionalProperties: false,
    },
    maxTokens: 1024,
  });

  return res.json(result);
}

async function generateCaption(req, res) {
  const { idea, hook, platform, cta, tone } = req.body;
  if (!idea?.trim()) return res.status(400).json({ error: 'idea is required' });

  const result = await generateStructured({
    system:
      'You are a senior copywriter for a digital marketing agency, writing platform-native captions that sound human, not like an AI.',
    prompt: [
      `Client: ${req.client.name}`,
      platform ? `Platform: ${platform}` : '',
      `Content idea: ${idea}`,
      hook ? `Hook/angle: ${hook}` : '',
      cta ? `Include this call to action naturally: ${cta}` : '',
      tone ? `Tone: ${tone}` : '',
      'Write one ready-to-post caption, appropriately sized for the platform, including relevant emoji only if it fits the tone.',
    ]
      .filter(Boolean)
      .join('\n'),
    schema: {
      type: 'object',
      properties: { caption: { type: 'string' } },
      required: ['caption'],
      additionalProperties: false,
    },
    maxTokens: 1024,
  });

  return res.json(result);
}

async function generateHook(req, res) {
  const { idea, platform } = req.body;
  if (!idea?.trim()) return res.status(400).json({ error: 'idea is required' });

  const result = await generateStructured({
    system: 'You are a senior copywriter specializing in scroll-stopping opening lines and hooks for social content.',
    prompt: [
      `Client: ${req.client.name}`,
      platform ? `Platform: ${platform}` : '',
      `Content idea: ${idea}`,
      'Write one short, attention-grabbing hook/opening line for this content — the first thing the viewer sees.',
    ]
      .filter(Boolean)
      .join('\n'),
    schema: {
      type: 'object',
      properties: { hook: { type: 'string' } },
      required: ['hook'],
      additionalProperties: false,
    },
    maxTokens: 512,
  });

  return res.json(result);
}

async function generateCalendar(req, res) {
  const { industry, businessType, platforms, postsPerWeek, pillars, startDate, goals } = req.body;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: 'platforms must be a non-empty array' });
  }
  if (!startDate) return res.status(400).json({ error: 'startDate is required' });

  const invalidPlatform = platforms.find((p) => !PLATFORMS.includes(p));
  if (invalidPlatform) return res.status(400).json({ error: `platforms must be one of: ${PLATFORMS.join(', ')}` });

  const perWeek = Math.min(Math.max(parseInt(postsPerWeek, 10) || 5, 1), 7);
  const pillarNames = Array.isArray(pillars) && pillars.length > 0 ? pillars : ['General'];

  const result = await generateStructured({
    system:
      'You are a senior digital marketing strategist. Produce a realistic, varied 30-day content calendar as strict structured data — no filler, no repeated ideas.',
    prompt: [
      `Client: ${req.client.name}`,
      `Industry: ${industry || req.client.industry || 'unspecified'}`,
      `Business type: ${businessType || req.client.businessType || 'unspecified'}`,
      `Platforms to plan for: ${platforms.join(', ')}`,
      `Content pillars to rotate through: ${pillarNames.join(', ')}`,
      `Target roughly ${perWeek} posts per week across the 30-day window (day offsets 0-29, 0 = start date).`,
      goals ? `Goals: ${goals}` : '',
      'For each entry, pick one pillar name from the list, one platform from the list, and a sensible content format for that platform. Vary ideas, hooks, and captions — never repeat the same idea twice.',
    ]
      .filter(Boolean)
      .join('\n'),
    schema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dayOffset: { type: 'integer' },
              format: { type: 'string', enum: CONTENT_FORMATS },
              platform: { type: 'string', enum: PLATFORMS },
              pillar: { type: 'string' },
              idea: { type: 'string' },
              hook: { type: 'string' },
              caption: { type: 'string' },
              cta: { type: 'string' },
            },
            required: ['dayOffset', 'format', 'platform', 'pillar', 'idea', 'hook', 'caption', 'cta'],
            additionalProperties: false,
          },
        },
      },
      required: ['entries'],
      additionalProperties: false,
    },
    maxTokens: 8192,
  });

  const base = new Date(startDate);
  const entries = (result.entries || []).map((e) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + Math.max(0, Math.min(29, e.dayOffset || 0)));
    return { ...e, date: date.toISOString().slice(0, 10) };
  });

  return res.json({ entries });
}

module.exports = { generateIdeas, generateCaption, generateHook, generateCalendar };
