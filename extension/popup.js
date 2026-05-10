'use strict';

// ─── Provider / Model catalogue (mirrored from background.js) ─────────────────
// Defined here directly so the popup never depends on the service worker
// being awake when it opens.
const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash ★' },
      { id: 'gemini-2.5-pro',         name: 'Gemini 2.5 Pro' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
      { id: 'gemini-3-pro-preview',   name: 'Gemini 3 Pro Preview' },
      { id: 'gemini-2.0-flash',       name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite',  name: 'Gemini 2.0 Flash Lite' },
    ],
  },
  anthropic: {
    name: 'Anthropic Claude',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-sonnet-4-6',         name: 'Claude Sonnet 4.6 ★' },
      { id: 'claude-opus-4-7',           name: 'Claude Opus 4.7' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini',  name: 'GPT-4o Mini ★' },
      { id: 'gpt-4o',       name: 'GPT-4o' },
      { id: 'gpt-4.1',      name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'o4-mini',      name: 'o4-mini' },
      { id: 'o3',           name: 'o3' },
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
      { id: 'meta/llama-3.3-70b-instruct',            name: 'Llama 3.3 70B ★' },
      { id: 'meta/llama-3.1-405b-instruct',           name: 'Llama 3.1 405B' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B' },
      { id: 'deepseek-ai/deepseek-r1',                name: 'DeepSeek R1 (NIM)' },
      { id: 'mistralai/mistral-large-2-instruct',     name: 'Mistral Large 2' },
    ],
  },
};

// ─── State ────────────────────────────────────────────────────────────────────
let templates = [];
let editingId = null;
let selectedProvider = 'gemini';

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const stored = await chrome.storage.local.get([
      'isEnabled', 'provider', 'model', 'apiKeys', 'settings', 'templates',
    ]);

    // Ensure apiKeys is always a plain object (guards against corrupted storage)
    const apiKeys = (stored.apiKeys && typeof stored.apiKeys === 'object' && !Array.isArray(stored.apiKeys))
      ? stored.apiKeys
      : {};

    // Enable toggle
    const enabled = stored.isEnabled !== false;
    const toggleEl = el('toggle-enabled');
    if (toggleEl) {
      toggleEl.checked = enabled;
      toggleEl.addEventListener('change', onToggleChange);
    }
    updateStatusBanner(enabled);

    // API section
    selectedProvider = stored.provider || 'gemini';
    buildProviderGrid(selectedProvider);
    buildModelDropdown(selectedProvider, stored.model);
    loadSavedKey(apiKeys, selectedProvider);
    updateKeyLink(selectedProvider);
    if (stored.provider && apiKeys[stored.provider]) {
      showApiStatus(true, `✓ ${PROVIDERS[stored.provider]?.name || stored.provider} key loaded.`);
    }

    // Enhancement settings
    const s = (stored.settings && typeof stored.settings === 'object') ? stored.settings : {};
    const toneEl = el('tone-select');
    const lengthEl = el('length-select');
    const scoresEl = el('include-scores');
    if (toneEl)   toneEl.value             = s.tone   || 'neutral';
    if (lengthEl) lengthEl.value           = s.length || 'concise';
    if (scoresEl) scoresEl.checked         = s.includeScores !== false;

    const reflectEl = el('reflection-mode');
    if (reflectEl) reflectEl.checked = s.reflectionMode !== false;

    // Use case
    buildUseCaseGrid(s.useCase || 'auto');

    // Temperature
    const temp = typeof s.temperature === 'number' ? s.temperature : 0.3;
    setTemperature(temp);

    // Templates
    templates = Array.isArray(stored.templates) && stored.templates.length
      ? stored.templates
      : defaultTemplates();
    renderTemplates();

    // Wire events
    el('save-api-btn')?.addEventListener('click', onSaveApi);
    el('test-api-btn')?.addEventListener('click', onTestApi);
    el('key-toggle-btn')?.addEventListener('click', toggleKeyVisibility);
    el('save-settings')?.addEventListener('click', onSaveSettings);
    el('add-template-btn')?.addEventListener('click', openAddForm);
    el('tpl-save')?.addEventListener('click', onSaveTemplate);
    el('tpl-cancel')?.addEventListener('click', closeTemplateForm);
    el('clear-history-btn')?.addEventListener('click', clearHistory);
    initTemperatureControls();
    renderHistory();

  } catch (err) {
    console.error('[PE Popup] init() failed:', err);
  }
}

// ─── Enable toggle ─────────────────────────────────────────────────────────────
async function onToggleChange() {
  const enabled = el('toggle-enabled').checked;
  await chrome.storage.local.set({ isEnabled: enabled });
  updateStatusBanner(enabled);
}

function updateStatusBanner(enabled) {
  const banner = el('status-banner');
  el('status-text').textContent = enabled
    ? 'Active on supported AI sites'
    : 'Extension disabled';
  banner.classList.toggle('status-off', !enabled);
}

// ─── Provider Grid ─────────────────────────────────────────────────────────────
function buildProviderGrid(active) {
  const grid = el('provider-grid');
  if (!grid) { console.error('[PE] provider-grid element not found'); return; }
  grid.innerHTML = '';

  for (const [id, info] of Object.entries(PROVIDERS || {})) {
    const btn = document.createElement('button');
    btn.className = 'provider-btn' + (id === active ? ' active' : '');
    btn.dataset.provider = id;
    btn.textContent = providerShortName(id);
    btn.title = info.name;
    btn.addEventListener('click', () => selectProvider(id));
    grid.appendChild(btn);
  }
}

function providerShortName(id) {
  const names = { gemini: 'Gemini', anthropic: 'Claude', openai: 'OpenAI', deepseek: 'DeepSeek', nvidia: 'Nvidia' };
  return names[id] || id;
}

async function selectProvider(id) {
  selectedProvider = id;

  // Update grid active state
  el('provider-grid').querySelectorAll('.provider-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.provider === id);
  });

  const stored = await chrome.storage.local.get(['model', 'apiKeys']);
  const apiKeys = (stored.apiKeys && typeof stored.apiKeys === 'object') ? stored.apiKeys : {};
  buildModelDropdown(id, stored.model);
  loadSavedKey(apiKeys, id);
  updateKeyLink(id);
  clearApiStatus();
}

function buildModelDropdown(providerId, savedModel) {
  const sel = el('model-select');
  sel.innerHTML = '';
  const models = PROVIDERS[providerId]?.models || [];
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  }
  // Select saved model if it belongs to this provider
  if (savedModel && models.some((m) => m.id === savedModel)) {
    sel.value = savedModel;
  }
}

function loadSavedKey(apiKeys, providerId) {
  const input = el('api-key-input');
  if (!input) return;
  const keys = (apiKeys && typeof apiKeys === 'object') ? apiKeys : {};
  input.value = keys[providerId] || '';
  input.type  = 'password';
  updateEyeIcon(false);
}

function updateKeyLink(providerId) {
  const link = el('key-link');
  link.href = PROVIDERS[providerId]?.keyLink || '#';
  link.textContent = `Get ${providerShortName(providerId)} key ↗`;
}

// ─── API Key show / hide ────────────────────────────────────────────────────────
function toggleKeyVisibility() {
  const input = el('api-key-input');
  const shown = input.type === 'text';
  input.type = shown ? 'password' : 'text';
  updateEyeIcon(!shown);
}

function updateEyeIcon(visible) {
  el('eye-icon').innerHTML = visible
    ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

// ─── Save API Settings ─────────────────────────────────────────────────────────
async function onSaveApi() {
  const provider = selectedProvider;
  const model    = el('model-select').value;
  const apiKey   = el('api-key-input').value.trim();

  if (!apiKey) {
    showApiStatus(false, 'Please enter an API key.');
    return;
  }

  const stored = await chrome.storage.local.get('apiKeys');
  const existingKeys = (stored.apiKeys && typeof stored.apiKeys === 'object') ? stored.apiKeys : {};
  const apiKeys = { ...existingKeys, [provider]: apiKey };

  await chrome.storage.local.set({ provider, model, apiKeys });
  const modelSel = el('model-select');
  const modelLabel = modelSel ? modelSel.options[modelSel.selectedIndex]?.text.replace(' ★', '') : model;
  showApiStatus(true, `Saved! Using ${PROVIDERS[provider]?.name || provider} — ${modelLabel}`);
}

// ─── Test Connection ───────────────────────────────────────────────────────────
async function onTestApi() {
  const btn = el('test-api-btn');
  btn.textContent = 'Testing…';
  btn.disabled = true;
  clearApiStatus();

  // Temporarily save current values so background can use them
  const provider = selectedProvider;
  const model    = el('model-select').value;
  const apiKey   = el('api-key-input').value.trim();

  if (!apiKey) {
    showApiStatus(false, 'Enter an API key first.');
    btn.textContent = 'Test Connection';
    btn.disabled = false;
    return;
  }

  // Save temp and test
  const stored = await chrome.storage.local.get('apiKeys');
  const existingKeys = (stored.apiKeys && typeof stored.apiKeys === 'object') ? stored.apiKeys : {};
  const apiKeys = { ...existingKeys, [provider]: apiKey };
  await chrome.storage.local.set({ provider, model, apiKeys });

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ENHANCE_PROMPT',
      payload: { prompt: 'Say hello in one word.', settings: {} },
    });
    if (result.error) {
      showApiStatus(false, result.error);
    } else {
      showApiStatus(true, `✓ Connected! ${PROVIDERS[provider].name} is working.`);
    }
  } catch (e) {
    showApiStatus(false, e.message);
  }

  btn.textContent = 'Test Connection';
  btn.disabled = false;
}

function showApiStatus(ok, msg) {
  const el_ = el('api-status');
  el_.className = 'api-status ' + (ok ? 'api-status-ok' : 'api-status-err');
  el_.textContent = msg || (ok ? '✓ API key saved' : '');
  el_.style.display = msg ? 'block' : 'none';
}

function clearApiStatus() {
  el('api-status').style.display = 'none';
}

// ─── Use Case Grid ─────────────────────────────────────────────────────────────
let selectedUseCase = 'auto';

function buildUseCaseGrid(active) {
  selectedUseCase = active || 'auto';
  el('usecase-grid')?.querySelectorAll('.usecase-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.usecase === selectedUseCase);
    btn.addEventListener('click', () => {
      selectedUseCase = btn.dataset.usecase;
      el('usecase-grid').querySelectorAll('.usecase-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.usecase === selectedUseCase)
      );
      // Auto-suggest temperature for this use case
      const suggested = { code: 0.2, job: 0.5, brainstorm: 0.9, auto: 0.3 }[selectedUseCase] ?? 0.3;
      setTemperature(suggested);
    });
  });
}

// ─── Temperature ───────────────────────────────────────────────────────────────
let currentTemp = 0.3;

function setTemperature(val) {
  currentTemp = Math.max(0, Math.min(1, Number(val) || 0.3));
  const rounded = Math.round(currentTemp * 100) / 100;

  const display = el('temp-display');
  const slider  = el('temp-slider');
  if (display) display.textContent = rounded.toFixed(2);
  if (slider) {
    slider.value = rounded;
    updateSliderTrack(slider);
  }

  // Highlight matching preset button
  document.querySelectorAll('.temp-btn').forEach((btn) => {
    btn.classList.toggle('active', parseFloat(btn.dataset.temp) === rounded);
  });
}

function updateSliderTrack(slider) {
  const pct = (parseFloat(slider.value) / 1) * 100;
  slider.style.background =
    `linear-gradient(to right, #6366f1 0%, #6366f1 ${pct}%, #e0e0e8 ${pct}%)`;
}

function initTemperatureControls() {
  // Preset buttons
  document.querySelectorAll('.temp-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTemperature(parseFloat(btn.dataset.temp)));
  });
  // Slider
  const slider = el('temp-slider');
  slider?.addEventListener('input', () => {
    setTemperature(parseFloat(slider.value));
  });
}

// ─── Enhancement Settings ──────────────────────────────────────────────────────
async function onSaveSettings() {
  const settings = {
    tone:           el('tone-select').value,
    length:         el('length-select').value,
    includeScores:  el('include-scores').checked,
    reflectionMode: el('reflection-mode')?.checked ?? true,
    useCase:        selectedUseCase,
    temperature:    currentTemp,
  };
  await chrome.storage.local.set({ settings });
  flashButton(el('save-settings'), 'Saved!');
}

function flashButton(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  btn.classList.add('btn-success');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn-success'); }, 1500);
}

// ─── Template list ─────────────────────────────────────────────────────────────
function renderTemplates() {
  const list = el('template-list');
  list.innerHTML = '';

  if (!templates.length) {
    list.innerHTML = '<p class="empty-msg">No templates. Click + Add to create one.</p>';
    return;
  }

  for (const tpl of templates) {
    const row = document.createElement('div');
    row.className = 'template-row';
    row.innerHTML = `
      <div class="tpl-info">
        <span class="tpl-trigger">${escHtml(tpl.trigger)}</span>
        <span class="tpl-name">${escHtml(tpl.name)}</span>
      </div>
      <div class="tpl-actions">
        <button class="btn-icon" data-action="edit"   data-id="${tpl.id}" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon btn-icon-danger" data-action="delete" data-id="${tpl.id}" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit')   openEditForm(btn.dataset.id);
    if (btn.dataset.action === 'delete') deleteTemplate(btn.dataset.id);
  });
}

function openAddForm() {
  editingId = null;
  el('tpl-trigger').value = '//';
  el('tpl-name').value    = '';
  el('tpl-content').value = '';
  el('template-form').classList.remove('hidden');
  el('add-template-btn').style.display = 'none';
  el('tpl-trigger').focus();
}

function openEditForm(id) {
  const tpl = templates.find((t) => t.id === id);
  if (!tpl) return;
  editingId = id;
  el('tpl-trigger').value = tpl.trigger;
  el('tpl-name').value    = tpl.name;
  el('tpl-content').value = tpl.content;
  el('template-form').classList.remove('hidden');
  el('add-template-btn').style.display = 'none';
  el('tpl-trigger').focus();
}

function closeTemplateForm() {
  editingId = null;
  el('template-form').classList.add('hidden');
  el('add-template-btn').style.display = '';
}

async function onSaveTemplate() {
  const trigger = el('tpl-trigger').value.trim();
  const name    = el('tpl-name').value.trim();
  const content = el('tpl-content').value.trim();

  if (!trigger.startsWith('//')) { alert('Trigger must start with //'); return; }
  if (!name || !content)         { alert('Name and content are required.'); return; }

  if (editingId) {
    templates = templates.map((t) => t.id === editingId ? { ...t, trigger, name, content } : t);
  } else {
    templates.push({ id: crypto.randomUUID(), trigger, name, content });
  }
  await chrome.storage.local.set({ templates });
  renderTemplates();
  closeTemplateForm();
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  templates = templates.filter((t) => t.id !== id);
  await chrome.storage.local.set({ templates });
  renderTemplates();
}

// ─── Enhancement History ───────────────────────────────────────────────────────
async function renderHistory() {
  const list      = el('history-list');
  const badge     = el('history-count');
  const hintEl    = el('history-hint');
  if (!list) return;

  const data = await chrome.storage.local.get('enhancementHistory');
  const history = Array.isArray(data.enhancementHistory) ? data.enhancementHistory : [];

  if (badge) {
    badge.textContent  = history.length;
    badge.style.display = history.length ? '' : 'none';
  }
  if (hintEl) {
    hintEl.textContent = history.length >= 3
      ? `${history.length} saved — personalised examples active.`
      : history.length > 0
        ? `${history.length} saved — ${3 - history.length} more needed for personalised examples.`
        : '';
  }

  if (!history.length) {
    list.innerHTML = '<p class="history-empty">No enhancements yet. Use the button on any AI chat input to get started.</p>';
    return;
  }

  const UC_LABELS = { code: '💻 Code', job: '💼 Job', brainstorm: '🚀 Brainstorm', general: '⚡ General' };
  const COPY_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;

  list.innerHTML = '';
  for (const entry of history) {
    const item = document.createElement('div');
    item.className = 'history-item';

    item.innerHTML = `
      <div class="history-meta">
        <span class="history-uc-badge">${UC_LABELS[entry.useCase] || '⚡ General'}</span>
        <span class="history-time">${relativeTime(entry.timestamp)}</span>
        <button class="history-copy-btn" title="Copy enhanced prompt">${COPY_ICON} Copy</button>
      </div>
      <div class="history-prompts">
        <div class="history-label">Original</div>
        <div class="history-original">${escHtml(entry.rawPrompt || '')}</div>
        <div class="history-arrow">↓ enhanced to</div>
        <div class="history-label">Enhanced</div>
        <div class="history-enhanced">${escHtml(entry.optimizedPrompt || '')}</div>
      </div>
      <div class="history-expand-hint">▼ expand</div>
    `;

    item.querySelector('.history-copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      navigator.clipboard.writeText(entry.optimizedPrompt || '').then(() => {
        btn.innerHTML = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = `${COPY_ICON} Copy`;
          btn.classList.remove('copied');
        }, 1500);
      }).catch(() => {});
    });

    item.addEventListener('click', () => {
      const expanded = item.classList.toggle('expanded');
      item.querySelector('.history-expand-hint').textContent = expanded ? '▲ collapse' : '▼ expand';
    });

    list.appendChild(item);
  }
}

async function clearHistory() {
  if (!confirm(`Clear all ${(await chrome.storage.local.get('enhancementHistory')).enhancementHistory?.length || 0} history entries? This also removes personalised examples.`)) return;
  await chrome.storage.local.remove('enhancementHistory');
  renderHistory();
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function escHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function defaultTemplates() {
  return [
    { id: 'summarize', trigger: '//summarize', name: 'Summarize', content: 'Summarize the following in [NUMBER] bullet points:\n\n[PASTE_CONTENT_HERE]' },
    { id: 'explain',   trigger: '//explain',   name: 'Explain',   content: 'Explain [CONCEPT] to a [AUDIENCE]. Use 2–3 concrete examples.' },
    { id: 'email',     trigger: '//email',     name: 'Email',     content: 'Write a [FORMAL/CASUAL] email to [RECIPIENT] about [SUBJECT].\nKey points: [POINTS]' },
    { id: 'code',      trigger: '//code',      name: 'Code',      content: 'Write [LANGUAGE] code that [TASK]. Requirements:\n- [REQ_1]\n- [REQ_2]\nAdd comments and handle edge cases.' },
    { id: 'research',  trigger: '//research',  name: 'Research',  content: 'Research [TOPIC]:\n1. Overview\n2. Key findings\n3. Pros and cons\n4. Recommendations\n\nFocus on: [ASPECT]' },
    { id: 'rewrite',   trigger: '//rewrite',   name: 'Rewrite',   content: 'Rewrite the following as [STYLE/TONE], keeping the meaning:\n\n[PASTE_TEXT_HERE]' },
  ];
}

document.addEventListener('DOMContentLoaded', init);
