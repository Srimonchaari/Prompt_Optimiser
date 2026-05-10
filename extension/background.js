'use strict';

// ─── System prompt ────────────────────────────────────────────────────────────
// Upgraded with:
//   - 4 structural frameworks: RISEN (code), RTF (job), TAG (brainstorm), COSTAR (general)
//   - 5 Essential Elements enforced on every output (Phase 3)
//   - Model-specific formatting rules: Claude=XML, GPT=bold headers, Gemini=markdown (Phase 2)
//   - Weak→Strong contrast examples showing the exact delta to create (Phase 4)
//   - Upgraded self-check with checklist (all 5 elements + zero filler)
const SYSTEM_PROMPT_OPTIMIZE = `You are a world-class prompt engineer. Your sole purpose: transform rough user prompts into structured, production-ready instructions that extract maximum quality from any AI model.

<framework_selection>
Select ONE framework based on detected use case and apply it structurally.

CODE / AI-BUILD → RISEN
  Role:         Expert [language/framework] engineer with specific stack experience
  Instructions: Precise input→output contract (data type in, data type out)
  Steps:        Numbered implementation sequence covering edge cases
  End goal:     Testable success condition ("handles N edge cases" / "passes unit tests")
  Narrowing:    Stack constraints, what to exclude, error handling expectation

JOB APPLICATION → RTF
  Role:   Expert career coach who knows the target industry and hiring culture
  Task:   Document type + XYZ formula enforced ("Accomplished X as measured by Y, resulting in Z")
  Format: Length limit, tone, section structure, "flag unverifiable claims" constraint

TECH BRAINSTORM → TAG
  Task:   N DISTINCT concepts (not variations of one idea) with specific evaluation metric
  Action: Per-idea scoring — feasibility / market size / moat / effort rating
  Goal:   Deliverable format (markdown table) + prioritisation constraint (underserved verticals first)

GENERAL / RESEARCH / COMPLEX → COSTAR
  Context:   Background, existing constraints, what the audience already knows
  Objective: Single measurable goal — one sentence, imperative
  Style:     Communication approach (analytical / narrative / step-by-step)
  Tone:      Register (professional / casual / technical / direct)
  Audience:  Who acts on this output and their expertise level
  Response:  Explicit format, section names, length target, success criterion
</framework_selection>

<five_essential_elements>
Every optimised prompt MUST contain all 5. If any is missing, add it before writing JSON.
1. ROLE       — Specific expert identity. Never "AI" or "assistant". ("Expert Python engineer" ✓ / "You are an AI" ✗)
2. DIRECTIVE  — Imperative verb + concrete, measurable deliverable. ("Return List[dict] with keys = headers" ✓ / "help me with" ✗)
3. CONTEXT    — Scope, constraints, what to exclude — with WHY each rule matters so the model can generalise
4. FORMAT     — Exact output structure: length, sections, code fences, table columns, word count
5. SUCCESS    — How the user verifies the output is correct or complete ("passes 3 edge-case tests" / "under 350 words")
</five_essential_elements>

<model_formatting>
The user message contains a <target_model> tag. Apply the matching style:
anthropic/claude  → wrap distinct sections in XML tags (<task>, <constraints>, <output_format>); write imperatively
openai/gpt        → use **Bold headers** + numbered lists; place output format instruction as the final block
gemini            → use ## Markdown headers + bullet lists; put role in the very first sentence
deepseek/nvidia   → be maximally compact and explicit; numbered steps only, zero prose decoration
no tag / unknown  → use clear section labels and numbered lists (safe default)
</model_formatting>

<contrast>
WEAK: "write python code to read csv"
STRONG (RISEN):
You are an expert Python engineer.
Task: Read a CSV file → return List[dict] where keys = column headers, one dict per row.
Steps: 1) auto-detect comma vs semicolon delimiter  2) substitute None for missing cells  3) raise ValueError with descriptive message if file is missing or empty
Narrowing: stdlib only — no pandas or third-party libs. Success: function passes 3 edge-case unit tests.
Output: def read_csv(path: str) -> List[dict] — include docstring and 2 usage examples in a fenced code block.

WEAK: "give me startup ideas using AI"
STRONG (TAG):
Task: Generate 5 DISTINCT AI startup concepts — not variations of the same idea. Each must solve a specific, verifiable problem in an underserved vertical (legal, healthcare, construction, agriculture). Exclude saturated spaces: productivity tools, generic chatbots, marketing copy.
Action: Evaluate each on Feasibility (solo-buildable with public APIs in ≤ 4 months), Market (paying customer segment named, not guessed), Moat (data advantage / workflow lock-in / domain expertise — one specific type).
Goal: Return as a markdown table — | Startup Name | Problem Solved | Core AI Mechanism | Who Pays & Why | Biggest Risk | — every cell must contain specifics, no vague placeholders.
</contrast>

<example>
INPUT: help me write a cover letter for a software engineering job
OPTIMISED (RTF):
You are an expert tech career coach who has reviewed 500+ successful software engineering applications at top-tier companies.

Write a cover letter for [COMPANY_NAME]'s [ROLE_TITLE] opening using this exact structure:
1. Opening — one specific, researched insight about [COMPANY_NAME]'s product or engineering culture that connects directly to my work. No generic openers ("I am excited to apply…").
2. Body (2 paragraphs) — map my experience to 2 key JD requirements using XYZ: "Accomplished X as measured by Y, resulting in Z". Include real numbers and named technologies.
3. Close — genuine enthusiasm + a clear, specific call-to-action.

Constraints: confident tone (never sycophantic), under 350 words, 3–4 short paragraphs.
Flag any achievement metric I should verify before an interview.

My background: [RELEVANT_EXPERIENCE]
Target role requirements: [2–3_KEY_JD_POINTS]
Success: Letter reads like it was written by someone who knows the company, not a template.
</example>

<scratchpad_integration>
If a <scratchpad> block appears in the user message, incorporate ALL proposed transformations freely. Improve the draft.
If <optimization_directives> appears, address the priority fix first.
Do not mention or acknowledge either block in your output.
</scratchpad_integration>

<self_check>
Before writing JSON, verify every item is present in the optimised prompt:
☐ Specific expert role (not generic "AI" or "assistant")
☐ Imperative directive with concrete, measurable deliverable
☐ Constraints with WHY for each rule
☐ Explicit output format (length / structure / format type)
☐ Success criteria the user can verify independently
☐ Zero filler words ("please", "could you", "basically", "just", "I want you to", "maybe")
Add any missing element. Then output JSON.
</self_check>

Score the ENHANCED prompt (1–10 integers):
• clarity: A colleague executes with zero clarifying questions
• specificity: Constraints, numbers, and format are concrete — no vague terms
• completeness: All 5 essential elements present (role / directive / context / format / success)
• tokenEfficiency: Zero filler, structured over prose wherever possible
• actionability: Output is immediately usable without reformatting

Respond directly — no preamble, no "Here is your enhanced prompt:". Return ONLY raw JSON:
{"optimizedPrompt":"...","useCase":"code|job|brainstorm|general","scores":{"clarity":9,"specificity":8,"completeness":9,"tokenEfficiency":8,"actionability":9},"missingInfo":["item1"],"summary":"One sentence: the single most important transformation applied."}`;

// ─── Reflection system prompt ─────────────────────────────────────────────────
// Multi-signal schema inspired by arXiv:2601.13922 — combines InterpretabilityScorer,
// PerformanceFeedback, and ReflectiveProposer roles into a single structured diagnosis call.
const SYSTEM_PROMPT_REFLECT = `You are a prompt quality auditor. Analyse the raw prompt and diagnose exactly why it underperforms.
Do NOT write the final enhanced prompt — write a structured multi-signal diagnosis only.

<scoring_dimensions>
• clarity: filler words, sentence length, logical structure
• specificity: concrete constraints, numbers, format specified
• completeness: role defined, output format stated, success criteria present
• tokenEfficiency: no redundant phrasing or hedge words
• actionability: clear deliverable, executable immediately
</scoring_dimensions>

<leakage_definition>
Leakage = the "enhanced" version merely rephrases the original without adding structural elements
(role, output format, constraints, scope) that were genuinely absent. A leaking prompt reads like
a polished copy, not a transformed instruction. Flag leakageRisk=true when the draft would score
< 20% more tokens than the raw prompt OR reuses > 60% of its key words without new structure.
</leakage_definition>

<coverage_definition>
coverageScore (0–100): percentage of distinct intent dimensions in the raw prompt that the draft
addresses. A prompt asking for "a Python script with error handling and 2 examples" has 3 intent
dimensions — a draft covering only 2 scores 67. Aim for ≥ 90.
</coverage_definition>

Given: (1) raw prompt, (2) gradient report of low-scoring dimensions, (3) optional history examples.

Return ONLY raw JSON — no preamble, no markdown fences:
{
  "weaknesses": ["2–4 strings, each naming ONE flaw and its consequence"],
  "transformations": ["2–4 strings, each naming ONE fix parallel to each weakness"],
  "draft": "rough first pass applying all transformations — imperfect is fine",
  "coverageScore": 0,
  "leakageRisk": false,
  "leakageReason": "one sentence — why the draft might be a shallow rewrite, or empty string if no risk",
  "interpretabilityNote": "one sentence — will a human find the enhanced prompt immediately usable",
  "highestImpactFix": "the single transformation that will produce the largest quality gain"
}`;

// ─── Gradient thresholds ──────────────────────────────────────────────────────
const GRADIENT_THRESHOLDS = {
  clarity:         { t: 6, msg: 'Vague language or filler phrases — model may misinterpret intent.' },
  specificity:     { t: 6, msg: 'No concrete constraints or output format — model cannot determine success criteria.' },
  completeness:    { t: 5, msg: 'Missing role and/or explicit output format — both dramatically improve quality.' },
  tokenEfficiency: { t: 6, msg: 'Redundant phrasing or hedge words consume tokens without adding information.' },
  actionability:   { t: 5, msg: 'No clear deliverable — model cannot determine what to produce.' },
};

// ─── Provider / Model catalogue ───────────────────────────────────────────────
const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash',        name: 'Gemini 2.5 Flash ★' },
      { id: 'gemini-2.5-pro',          name: 'Gemini 2.5 Pro' },
      { id: 'gemini-3-flash-preview',  name: 'Gemini 3 Flash Preview' },
      { id: 'gemini-3-pro-preview',    name: 'Gemini 3 Pro Preview' },
      { id: 'gemini-2.0-flash',        name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite',   name: 'Gemini 2.0 Flash Lite' },
    ],
  },
  anthropic: {
    name: 'Anthropic Claude',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-sonnet-4-6',          name: 'Claude Sonnet 4.6 ★' },
      { id: 'claude-opus-4-7',            name: 'Claude Opus 4.7' },
      { id: 'claude-haiku-4-5-20251001',  name: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini ★' },
      { id: 'gpt-4o',      name: 'GPT-4o' },
      { id: 'gpt-4.1',     name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini',name: 'GPT-4.1 Mini' },
      { id: 'o4-mini',     name: 'o4-mini' },
      { id: 'o3',          name: 'o3' },
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat',     name: 'DeepSeek V3 (Chat) ★' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)' },
    ],
  },
  nvidia: {
    name: 'Nvidia NIM',
    keyPlaceholder: 'nvapi-...',
    keyLink: 'https://build.nvidia.com',
    models: [
      { id: 'meta/llama-3.3-70b-instruct',               name: 'Llama 3.3 70B ★' },
      { id: 'meta/llama-3.1-405b-instruct',              name: 'Llama 3.1 405B' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct',    name: 'Nemotron 70B' },
      { id: 'deepseek-ai/deepseek-r1',                   name: 'DeepSeek R1 (NIM)' },
      { id: 'mistralai/mistral-large-2-instruct',        name: 'Mistral Large 2' },
    ],
  },
};

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ENHANCE_PROMPT') {
    handleEnhance(message.payload).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message || 'Unknown error' });
    });
    return true;
  }

  if (message.type === 'SAVE_ENHANCEMENT') {
    appendToHistory(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// ─── Main enhancement flow ────────────────────────────────────────────────────
async function handleEnhance({ prompt, settings = {} }) {
  const config = await chrome.storage.local.get(['provider', 'model', 'apiKeys']);
  const provider = config.provider;
  const model    = config.model;
  const apiKey   = config.apiKeys?.[provider];

  if (!provider || !model) {
    throw new Error('No AI provider selected. Open the extension popup and configure your API key.');
  }
  if (!apiKey) {
    throw new Error(`No API key saved for ${PROVIDERS[provider]?.name || provider}. Open the popup to add one.`);
  }

  const temp = resolveTemperature(settings);
  const reflectionMode = settings.reflectionMode !== false;

  const originalScores = scorePromptLocally(prompt);
  const avgScore = Object.values(originalScores).reduce((a, b) => a + b, 0) / 5;

  const history = await loadHistory();
  const dynamicExamples = selectDynamicExamples(prompt, settings.useCase, history);
  const gradientReport  = buildGradientReport(prompt, originalScores);

  let scratchpad = null;
  if (reflectionMode && avgScore < 7.5) {
    try {
      const reflectRaw = await callProvider(
        apiKey, provider, model,
        SYSTEM_PROMPT_REFLECT,
        buildReflectUserMessage(prompt, gradientReport, dynamicExamples),
        0.2
      );
      scratchpad = parseReflectResponse(reflectRaw);
    } catch (_e) {
      // silent — pipeline continues without scratchpad
    }
  }

  const optimizeMsg = buildOptimizeUserMessage(prompt, settings, gradientReport, dynamicExamples, scratchpad, provider, model);
  const rawText = await callProvider(apiKey, provider, model, SYSTEM_PROMPT_OPTIMIZE, optimizeMsg, temp);

  const result = parseResponse(rawText, prompt);
  result.originalScores        = originalScores;
  result.temperature           = temp;
  result.usedReflection        = scratchpad !== null;
  result.gradientReport        = gradientReport;
  result.coverageScore         = typeof scratchpad?.coverageScore === 'number' ? scratchpad.coverageScore : null;
  result.leakageRisk           = scratchpad?.leakageRisk === true;
  result.leakageReason         = scratchpad?.leakageReason || null;
  result.localLeakageWarning   = computeLocalLeakage(prompt, result.optimizedPrompt);
  return result;
}

// Temperature defaults per use case (based on OpenAI/Anthropic guidance):
// code → 0.2 (precise, deterministic), job → 0.5 (balanced), brainstorm → 0.8 (creative)
const USE_CASE_TEMPS = { code: 0.2, job: 0.5, brainstorm: 0.8, general: 0.3 };

function resolveTemperature(settings) {
  if (typeof settings.temperature === 'number') return clampTemp(settings.temperature);
  if (settings.useCase && USE_CASE_TEMPS[settings.useCase]) return USE_CASE_TEMPS[settings.useCase];
  return 0.3;
}

function clampTemp(t) { return Math.max(0, Math.min(1, Number(t) || 0.3)); }

function buildUserMessage(prompt, settings) {
  const parts = [`Raw prompt:\n${prompt}`];
  if (settings.useCase && settings.useCase !== 'auto') {
    parts.push(`Use case: ${settings.useCase}`);
  }
  if (settings.tone && settings.tone !== 'neutral')  parts.push(`Desired tone: ${settings.tone}`);
  if (settings.length && settings.length !== 'concise') parts.push(`Output length: ${settings.length}`);
  return parts.join('\n\n');
}

// ─── Gradient report ──────────────────────────────────────────────────────────
function buildGradientReport(prompt, scores) {
  const deficits = [];
  for (const [dim, { t, msg }] of Object.entries(GRADIENT_THRESHOLDS)) {
    if ((scores[dim] || 0) < t) {
      deficits.push(`[${dim} = ${scores[dim]}] ${msg}`);
    }
  }
  if (deficits.length === 0) return 'All dimensions above threshold — minor polish only.';
  return 'Quality deficits detected:\n' + deficits.join('\n');
}

// ─── Local leakage heuristic (arXiv:2601.13922) ───────────────────────────────
// Flags when the enhanced prompt is a shallow rewrite of the original:
// Jaccard word overlap > 65% AND length grew < 20% → likely just rephrased.
function computeLocalLeakage(raw, optimized) {
  if (!raw || !optimized) return false;
  const rawWords = new Set(raw.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const optWords = new Set(optimized.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const shared   = [...rawWords].filter((w) => optWords.has(w)).length;
  const union    = new Set([...rawWords, ...optWords]).size;
  const jaccard  = union > 0 ? shared / union : 0;
  const lengthGrowth = raw.length > 0 ? (optimized.length - raw.length) / raw.length : 1;
  return jaccard > 0.65 && lengthGrowth < 0.2;
}

// ─── History helpers ──────────────────────────────────────────────────────────
async function loadHistory() {
  const data = await chrome.storage.local.get(['enhancementHistory']);
  return Array.isArray(data.enhancementHistory) ? data.enhancementHistory : [];
}

async function appendToHistory(payload) {
  const history = await loadHistory();
  history.unshift(payload);
  await chrome.storage.local.set({ enhancementHistory: history.slice(0, 20) });
}

// ─── Dynamic few-shot selection ───────────────────────────────────────────────
function selectDynamicExamples(rawPrompt, useCase, history) {
  if (!Array.isArray(history) || history.length < 3) return [];

  const promptWords = topWords(rawPrompt);
  const scored = history.map((entry) => {
    let score = 0;
    if (useCase && entry.useCase === useCase) score += 2;
    const entryWords = topWords(entry.rawPrompt || '');
    const shared = promptWords.filter((w) => entryWords.includes(w)).length;
    const union  = new Set([...promptWords, ...entryWords]).size;
    if (union > 0) score += (shared / union) * 3;
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.entry);
}

function topWords(text) {
  const stop = new Set(['the','a','an','is','in','on','at','to','of','and','or','for','with','that','this','it','i','you','my','we','can','do','be','by','as','are','was','have','has']);
  return (text || '')
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 15);
}

function formatDynamicExamples(examples) {
  if (!examples || examples.length === 0) return '';
  return examples.map((ex, i) =>
    `<historical_example_${i + 1}>\nINPUT: ${ex.rawPrompt}\nOPTIMISED: ${ex.optimizedPrompt}\n</historical_example_${i + 1}>`
  ).join('\n\n');
}

// ─── Reflect pass helpers ─────────────────────────────────────────────────────
function parseReflectResponse(raw) {
  if (!raw) return null;
  const text = raw.trim()
    .replace(/^```(?:json)?[\r\n]*/im, '')
    .replace(/[\r\n]*```\s*$/m, '')
    .trim();
  return tryParse(text) || tryParse(extractJsonObject(text));
}

function buildReflectUserMessage(prompt, gradientReport, examples) {
  const parts = [
    `<raw_prompt>${prompt}</raw_prompt>`,
    `<gradient_report>${gradientReport}</gradient_report>`,
  ];
  const exStr = formatDynamicExamples(examples);
  if (exStr) parts.push(`<historical_examples>${exStr}</historical_examples>`);
  parts.push('Task: Analyse and return scratchpad JSON.');
  return parts.join('\n\n');
}

function buildOptimizeUserMessage(prompt, settings, gradientReport, examples, scratchpad, provider, model) {
  const parts = [`Raw prompt: ${prompt}`];
  if (provider && model) parts.push(`<target_model>${provider}/${model}</target_model>`);
  if (settings.useCase && settings.useCase !== 'auto') parts.push(`Use case: ${settings.useCase}`);
  if (settings.tone && settings.tone !== 'neutral')    parts.push(`Desired tone: ${settings.tone}`);
  if (settings.length && settings.length !== 'concise') parts.push(`Output length: ${settings.length}`);
  parts.push(gradientReport);
  const exStr = formatDynamicExamples(examples);
  if (exStr) parts.push(exStr);

  if (scratchpad) {
    parts.push(`<scratchpad>${JSON.stringify(scratchpad)}</scratchpad>`);

    // Inject ranked directives from multi-signal diagnosis (arXiv:2601.13922 pattern)
    const directives = [];
    if (scratchpad.highestImpactFix)
      directives.push(`Priority fix: ${scratchpad.highestImpactFix}`);
    if (typeof scratchpad.coverageScore === 'number')
      directives.push(`Coverage target: current draft covers ${scratchpad.coverageScore}% of intent dimensions — push to ≥ 90%.`);
    if (scratchpad.leakageRisk)
      directives.push(`Leakage guard: ${scratchpad.leakageReason || 'draft is too close to original'} — the output MUST add role, output format, and constraints that are genuinely absent from the raw prompt.`);
    if (scratchpad.interpretabilityNote)
      directives.push(`Interpretability: ${scratchpad.interpretabilityNote}`);

    if (directives.length > 0) {
      parts.push(`<optimization_directives>\n${directives.join('\n')}\n</optimization_directives>`);
    }
  }

  return parts.join('\n\n');
}

// ─── Provider dispatcher ──────────────────────────────────────────────────────
async function callProvider(apiKey, provider, model, systemPrompt, userMsg, temp) {
  switch (provider) {
    case 'gemini':    return callGemini(apiKey, model, systemPrompt, userMsg, temp);
    case 'anthropic': return callAnthropic(apiKey, model, systemPrompt, userMsg, temp);
    case 'openai':    return callOpenAI(apiKey, model, systemPrompt, userMsg, 'https://api.openai.com', temp);
    case 'deepseek':  return callOpenAI(apiKey, model, systemPrompt, userMsg, 'https://api.deepseek.com', temp);
    case 'nvidia':    return callOpenAI(apiKey, model, systemPrompt, userMsg, 'https://integrate.api.nvidia.com', temp);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(apiKey, model, systemPrompt, userMsg, temperature = 0.3) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userMsg }] }],
    generationConfig: { maxOutputTokens: 1500, temperature },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(await extractApiError(resp, 'Gemini'));
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Anthropic ────────────────────────────────────────────────────────────────
async function callAnthropic(apiKey, model, systemPrompt, userMsg, temperature = 0.3) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-calls': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!resp.ok) throw new Error(await extractApiError(resp, 'Anthropic'));
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

// ─── OpenAI-compatible (OpenAI / DeepSeek / Nvidia) ──────────────────────────
async function callOpenAI(apiKey, model, systemPrompt, userMsg, baseUrl, temperature = 0.3) {
  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
    }),
  });

  if (!resp.ok) throw new Error(await extractApiError(resp, baseUrl));
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Response parsing ─────────────────────────────────────────────────────────
function parseResponse(raw, originalPrompt) {
  let text = (raw || '').trim()
    .replace(/^```(?:json)?[\r\n]*/im, '')
    .replace(/[\r\n]*```\s*$/m, '')
    .trim();

  let parsed = tryParse(text) || tryParse(extractJsonObject(text));

  if (!parsed) {
    throw new Error(`Could not parse AI response. Please try again.\n\nRaw: ${text.slice(0, 150)}`);
  }

  const validUseCases = ['code', 'job', 'brainstorm', 'general'];
  return {
    optimizedPrompt: String(parsed.optimizedPrompt || originalPrompt),
    originalScores:  null, // overwritten by caller
    scores:          sanitizeScores(parsed.scores || parsed.enhancedScores),
    missingInfo:     Array.isArray(parsed.missingInfo) ? parsed.missingInfo.slice(0, 3).map(String) : [],
    summary:         String(parsed.summary || 'Prompt optimized for clarity and effectiveness.'),
    useCase:         validUseCases.includes(parsed.useCase) ? parsed.useCase : 'general',
  };
}

function tryParse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape)              { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true;  continue; }
    if (ch === '"')          { inString = !inString; continue; }
    if (inString)            continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function sanitizeScores(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const c = (v) => Math.max(1, Math.min(10, Math.round(Number(v) || 5)));
  return {
    clarity:         c(raw.clarity),
    specificity:     c(raw.specificity),
    completeness:    c(raw.completeness),
    tokenEfficiency: c(raw.tokenEfficiency),
    actionability:   c(raw.actionability),
  };
}

async function extractApiError(resp, label) {
  try {
    const data = await resp.json();
    return `${label} error ${resp.status}: ${data?.error?.message || JSON.stringify(data)}`;
  } catch {
    return `${label} error ${resp.status}`;
  }
}

// ─── Local heuristic scorer ───────────────────────────────────────────────────
// Runs client-side so original scores are always deterministic.
function scorePromptLocally(prompt) {
  if (!prompt) return zeroScores();
  const text  = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean);
  const sents = text.split(/[.!?]+/).filter((s) => s.trim().length > 3);
  const lower = text.toLowerCase();
  const clamp = (v) => Math.max(1, Math.min(10, Math.round(v)));

  // Clarity
  let clarity = 5;
  if (sents.length > 0) {
    const avg = words.length / sents.length;
    if (avg < 15) clarity += 2; else if (avg > 30) clarity -= 2;
  }
  const fillers = ['thing','stuff','something','somehow','whatever','kind of','sort of','maybe','basically','literally'];
  clarity -= Math.min(fillers.filter((f) => lower.includes(f)).length * 1.5, 3);
  if (['\n', ':', '-', '1.', 'first', 'then'].some((m) => text.includes(m))) clarity += 1;

  // Specificity
  let specificity = 4;
  if      (words.length < 5)  specificity -= 2;
  else if (words.length >= 20) specificity += 2;
  else if (words.length >= 10) specificity += 1;
  const specWords = ['exactly','specific','format','example','must','should','only','limit','step','maximum','minimum'];
  specificity += Math.min(specWords.filter((w) => lower.includes(w)).length, 3);
  if (/\d+/.test(text)) specificity += 1;

  // Completeness
  let completeness = 3;
  if (['as a','you are','act as','expert','professional'].some((w) => lower.includes(w))) completeness += 2;
  if (['format','output','return','list','json','bullet','summary','table'].some((w) => lower.includes(w))) completeness += 2;
  if (['must','avoid','do not','limit','only','without'].some((w) => lower.includes(w))) completeness += 1;
  if (words.length >= 30) completeness += 1;
  if (words.length >= 60) completeness += 1;

  // Token efficiency
  let tokenEff = 7;
  if (words.length < 3)   tokenEff = 3;
  else if (words.length > 200) tokenEff -= 2;
  else if (words.length > 100) tokenEff -= 1;
  const redundant = ['please note that','i would like you to','can you please','could you please','i want you to'];
  tokenEff -= Math.min(redundant.filter((p) => lower.includes(p)).length, 2);

  // Actionability
  let actionability = 4;
  const actions = ['write','create','generate','list','explain','summarize','analyze','compare','identify','describe','evaluate','translate','rewrite','fix','debug','suggest','recommend','design'];
  actionability += Math.min(actions.filter((v) => lower.includes(v)).length * 1.5, 3);
  if (['report','email','code','function','plan','summary','essay','solution','draft'].some((d) => lower.includes(d))) actionability += 1;
  if (words.length < 4) actionability -= 2;

  return {
    clarity:         clamp(clarity),
    specificity:     clamp(specificity),
    completeness:    clamp(completeness),
    tokenEfficiency: clamp(tokenEff),
    actionability:   clamp(actionability),
  };
}

function zeroScores() {
  return { clarity: 1, specificity: 1, completeness: 1, tokenEfficiency: 1, actionability: 1 };
}
