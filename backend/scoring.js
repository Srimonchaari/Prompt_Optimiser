'use strict';

/**
 * Heuristic prompt scorer.
 * Used as a fallback or for fast local scoring without an AI call.
 * Scores are approximate and intentionally conservative.
 */

/**
 * Score a prompt across five dimensions (1–10 each).
 * @param {string} prompt
 * @returns {{ clarity, specificity, completeness, tokenEfficiency, actionability }}
 */
function scorePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return zeroScores();
  }

  const text = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 3);
  const wordCount = words.length;
  const charCount = text.length;

  return {
    clarity:         scoreClarity(text, words, sentences),
    specificity:     scoreSpecificity(text, words),
    completeness:    scoreCompleteness(text, words),
    tokenEfficiency: scoreTokenEfficiency(text, wordCount, charCount),
    actionability:   scoreActionability(text, words),
  };
}

// ─── Individual Dimension Scorers ─────────────────────────────────────────────

function scoreClarity(text, words, sentences) {
  let score = 5;

  // Long sentences reduce clarity
  if (sentences.length > 0) {
    const avgLen = words.length / sentences.length;
    if (avgLen < 15) score += 2;
    else if (avgLen > 30) score -= 2;
  }

  // Vague filler words hurt clarity
  const fillers = ['thing', 'stuff', 'something', 'somehow', 'whatever', 'kind of', 'sort of', 'maybe', 'perhaps', 'basically', 'literally'];
  const fillerCount = fillers.filter((f) => text.toLowerCase().includes(f)).length;
  score -= Math.min(fillerCount * 1.5, 3);

  // Questions without context hurt clarity
  if (text.includes('?') && words.length < 8) score -= 1;

  // Structured markers improve clarity
  const structureMarkers = ['\n', ':', '-', '1.', '2.', 'first', 'then', 'finally'];
  if (structureMarkers.some((m) => text.includes(m))) score += 1;

  return clamp(Math.round(score));
}

function scoreSpecificity(text, words) {
  let score = 4;
  const lower = text.toLowerCase();

  // Short prompts are typically vague
  if (words.length < 5) score -= 2;
  else if (words.length >= 20) score += 2;
  else if (words.length >= 10) score += 1;

  // Specific indicators
  const specificWords = ['exactly', 'specific', 'format', 'example', 'must', 'should', 'only', 'limit', 'maximum', 'minimum', 'step'];
  score += Math.min(specificWords.filter((w) => lower.includes(w)).length, 3);

  // Numbers and measurements suggest specificity
  if (/\d+/.test(text)) score += 1;

  // Generic requests score lower
  const genericWords = ['help', 'write', 'make', 'do', 'create', 'give me'];
  const genericCount = genericWords.filter((w) => lower.includes(w)).length;
  if (genericCount >= 2 && words.length < 15) score -= 1;

  return clamp(Math.round(score));
}

function scoreCompleteness(text, words) {
  let score = 3;
  const lower = text.toLowerCase();

  // Prompts with role context score higher
  const roleWords = ['as a', 'i am', 'you are', 'act as', 'role', 'expert', 'professional'];
  if (roleWords.some((w) => lower.includes(w))) score += 2;

  // Prompts with output format hints score higher
  const formatWords = ['format', 'output', 'return', 'list', 'table', 'json', 'markdown', 'bullet', 'paragraph', 'summary'];
  if (formatWords.some((w) => lower.includes(w))) score += 2;

  // Prompts with constraints score higher
  const constraintWords = ['must', 'should not', 'avoid', 'do not', 'without', 'limit', 'max', 'only'];
  if (constraintWords.some((w) => lower.includes(w))) score += 1;

  // Context / background info
  if (words.length >= 30) score += 1;
  if (words.length >= 60) score += 1;

  return clamp(Math.round(score));
}

function scoreTokenEfficiency(text, wordCount, charCount) {
  let score = 7; // assume reasonable by default

  // Very short prompts waste no tokens but also have no value
  if (wordCount < 3) return 3;

  // Very long prompts may be inefficient
  if (wordCount > 200) score -= 2;
  else if (wordCount > 100) score -= 1;

  // Redundant phrases
  const redundant = ['please note that', 'it is important to note', 'i would like you to', 'can you please', 'could you please', 'i want you to'];
  const redundantCount = redundant.filter((p) => text.toLowerCase().includes(p)).length;
  score -= Math.min(redundantCount, 2);

  // Repetition penalty (rough check: high char/word ratio is OK, very high may indicate filler)
  const avgWordLen = charCount / wordCount;
  if (avgWordLen > 12) score -= 1; // unusually long words may signal repetition

  return clamp(Math.round(score));
}

function scoreActionability(text, words) {
  let score = 4;
  const lower = text.toLowerCase();

  // Strong action verbs
  const actionVerbs = ['write', 'create', 'generate', 'list', 'explain', 'summarize', 'analyze', 'compare', 'identify', 'describe', 'evaluate', 'translate', 'rewrite', 'fix', 'debug', 'suggest', 'recommend', 'design'];
  const verbCount = actionVerbs.filter((v) => lower.includes(v)).length;
  score += Math.min(verbCount * 1.5, 3);

  // Clear deliverable mentioned
  const deliverables = ['report', 'email', 'code', 'function', 'plan', 'list', 'summary', 'essay', 'response', 'answer', 'solution', 'draft'];
  if (deliverables.some((d) => lower.includes(d))) score += 1;

  // Very short prompts are rarely actionable
  if (words.length < 4) score -= 2;

  return clamp(Math.round(score));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value) {
  return Math.max(1, Math.min(10, value));
}

function zeroScores() {
  return { clarity: 1, specificity: 1, completeness: 1, tokenEfficiency: 1, actionability: 1 };
}

module.exports = { scorePrompt };
