'use strict';

const { scorePrompt } = require('./scoring');

const SYSTEM_PROMPT = `You are an expert prompt optimization engine.

Your task is to rewrite the user's raw prompt into a clear, concise, high-performing AI prompt.

Rules:
- Preserve the user's EXACT original intent — do not change the topic or goal.
- Do NOT invent or assume missing facts.
- Add role, task, context, constraints, and output format where genuinely useful.
- Remove vague wording and filler phrases.
- Add [PLACEHOLDER] markers for any critical missing information the user should fill in.
- Optimize for clarity and token efficiency.
- Structure the prompt logically.

Score the ENHANCED prompt only on these dimensions (1–10 integers):
- clarity: How clear and unambiguous is it?
- specificity: How specific and detailed is the request?
- completeness: Does it include all necessary context?
- tokenEfficiency: Is it concise without losing meaning?
- actionability: Does it clearly define the desired action or output?

Identify missing information that would make the prompt even better (short noun phrases, max 5 items).

Return ONLY raw JSON — absolutely no markdown, no code fences, no extra text before or after:
{"optimizedPrompt":"...","scores":{"clarity":9,"specificity":8,"completeness":8,"tokenEfficiency":7,"actionability":9},"missingInfo":["item1","item2"],"summary":"One sentence describing what changed."}`;

// ─── Provider detection ───────────────────────────────────────────────────────

function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function enhancePrompt({ prompt, mode = 'default', settings = {} }) {
  const provider = detectProvider();

  if (!provider) {
    throw new Error(
      'No AI API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in your .env file.'
    );
  }

  // Score the original prompt locally — deterministic and always accurate
  const originalScores = scorePrompt(prompt);

  const userMessage = buildUserMessage(prompt, settings);

  let rawText;
  switch (provider) {
    case 'anthropic': rawText = await callAnthropic(userMessage); break;
    case 'openai':    rawText = await callOpenAI(userMessage);    break;
    case 'gemini':    rawText = await callGemini(userMessage);    break;
  }

  const result = parseResponse(rawText, prompt);
  result.originalScores = originalScores; // always override with local scores
  return result;
}

function buildUserMessage(prompt, settings) {
  const parts = [`Raw prompt:\n${prompt}`];
  if (settings.tone && settings.tone !== 'neutral') {
    parts.push(`Desired tone for the enhanced prompt: ${settings.tone}`);
  }
  if (settings.length && settings.length !== 'concise') {
    parts.push(`Output length preference: ${settings.length}`);
  }
  return parts.join('\n\n');
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(userMessage) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0]?.text || '';
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(userMessage) {
  const OpenAI = require('openai');
  const client = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  });

  return response.choices[0]?.message?.content || '';
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini(userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Note: responseMimeType is omitted — not all preview models support it.
  // The system prompt instructs the model to return raw JSON instead.
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (process.env.NODE_ENV !== 'production') {
    console.log('[gemini] raw response preview:', text.slice(0, 300));
  }

  return text;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseResponse(raw, originalPrompt) {
  let text = (raw || '').trim();

  if (process.env.NODE_ENV !== 'production') {
    console.log('[parse] raw text:', text.slice(0, 400));
  }

  // Strip ALL markdown code fences (```json ... ``` or ``` ... ```)
  text = text
    .replace(/^```(?:json)?[\r\n]*/im, '')
    .replace(/[\r\n]*```\s*$/m, '')
    .trim();

  // Try direct parse first
  let parsed = tryParse(text);

  // If that fails, use brace-matching to find the outermost JSON object
  if (!parsed) {
    const extracted = extractJsonObject(text);
    if (extracted) parsed = tryParse(extracted);
  }

  if (!parsed) {
    throw new Error(
      `AI returned an unexpected response format. Raw (first 200 chars): ${text.slice(0, 200)}`
    );
  }

  return {
    optimizedPrompt: String(parsed.optimizedPrompt || originalPrompt),
    originalScores:  sanitizeScores(parsed.originalScores),
    scores:          sanitizeScores(parsed.scores || parsed.enhancedScores),
    missingInfo:     Array.isArray(parsed.missingInfo)
      ? parsed.missingInfo.slice(0, 5).map(String)
      : [],
    summary: String(parsed.summary || 'Prompt optimized for clarity and effectiveness.'),
  };
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Walk character-by-character to find the outermost { ... } block,
// correctly handling nested objects and strings with braces inside them.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape)              { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true;  continue; }
    if (ch === '"')          { inString = !inString; continue; }
    if (inString)            { continue; }
    if (ch === '{')          { depth++; }
    if (ch === '}')          { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function sanitizeScores(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clamp = (v) => Math.max(1, Math.min(10, Math.round(Number(v) || 5)));
  return {
    clarity:         clamp(raw.clarity),
    specificity:     clamp(raw.specificity),
    completeness:    clamp(raw.completeness),
    tokenEfficiency: clamp(raw.tokenEfficiency),
    actionability:   clamp(raw.actionability),
  };
}

module.exports = { enhancePrompt, detectProvider };
