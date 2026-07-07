const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

function isAIEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function extractJSON(response) {
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('AI returned no content');
  return JSON.parse(block.text);
}

/**
 * Calls Claude with a JSON-schema-constrained response (output_config.format) and returns the
 * parsed result. Throws a { status: 503 } error up front if ANTHROPIC_API_KEY isn't configured,
 * so callers can surface a clear "not configured" message instead of crashing the process.
 */
async function generateStructured({ system, prompt, schema, maxTokens = 4096 }) {
  if (!isAIEnabled()) {
    const err = new Error('AI features are not configured. Add ANTHROPIC_API_KEY to server/.env to enable them.');
    err.status = 503;
    throw err;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema } },
  });

  if (response.stop_reason === 'refusal') {
    const err = new Error('The AI declined to generate this content. Try rephrasing your request.');
    err.status = 422;
    throw err;
  }

  return extractJSON(response);
}

module.exports = { isAIEnabled, generateStructured };
