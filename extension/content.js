'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const BLUR_HIDE_DELAY_MS = 200; // give time for button clicks before hiding

const INPUT_SELECTORS = [
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[aria-multiline="true"]',
  '.ProseMirror',                        // Claude.ai Tiptap / ProseMirror editor
  '[data-testid="chat-input"]',          // Claude.ai wrapper fallback
].join(',');

// Minimum dimensions to qualify as an AI chat input field
const MIN_WIDTH = 150;
const MIN_HEIGHT = 20; // lowered from 30 — Claude.ai's editor can be ~24px tall when empty

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  activeInput: null,
  enhanceButton: null,
  templateDropdown: null,
  modal: null,
  isEnabled: true,
  isProcessing: false,
  templates: [],
  settings: { tone: 'neutral', length: 'concise', includeScores: true },
  hideTimeout: null,
  savedBtnPos: null, // { top, left } — user-dragged position, persisted in storage
};

// ─── Extension context guard ──────────────────────────────────────────────────
// chrome.runtime.id becomes undefined when the extension is reloaded/updated
// while this content script is still alive in the page. Any chrome.runtime call
// after that throws "Extension context invalidated." We detect it early and
// degrade gracefully rather than silently failing.
function isContextAlive() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function init() {
  if (!isContextAlive()) return;
  const stored = await chrome.storage.local.get(['isEnabled', 'templates', 'settings', 'enhanceBtnPosition']);

  // Restore user-dragged position if saved
  state.savedBtnPos = stored.enhanceBtnPosition || null;

  state.isEnabled = stored.isEnabled !== false;
  state.templates = stored.templates?.length ? stored.templates : getDefaultTemplates();
  state.settings  = stored.settings || state.settings;

  if (state.isEnabled) {
    attachToExistingInputs();
    setupMutationObserver();
    setupFocusInFallback(); // catches inputs the mutation observer missed (e.g. Claude.ai SPA nav)
  }

  chrome.storage.onChanged.addListener((changes) => {
    if ('isEnabled' in changes) {
      state.isEnabled = changes.isEnabled.newValue;
      if (!state.isEnabled) { removeEnhanceButton(); removeTemplateDropdown(); }
    }
    if ('templates' in changes) state.templates = changes.templates.newValue;
    if ('settings'  in changes) state.settings  = changes.settings.newValue;
  });
}

// ─── Input Detection ──────────────────────────────────────────────────────────
function setupMutationObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        findInputs(node).forEach(attach);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function attachToExistingInputs() {
  findInputs(document).forEach(attach);
}

// Fallback for SPAs (Claude.ai, Gemini) where the editor mounts after the
// mutation observer fires. On focusin, check if the newly-focused element
// is an unattached input and attach on the spot.
function setupFocusInFallback() {
  document.addEventListener('focusin', (e) => {
    if (!state.isEnabled) return;
    const el = e.target;
    if (!el || el._peAttached) return;
    if (el.matches?.(INPUT_SELECTORS) && isUsableInput(el)) {
      attach(el);
    }
  }, true); // capture phase — fires before the element's own focus handlers
}

function findInputs(root) {
  const results = [];
  try {
    const els = root.querySelectorAll ? root.querySelectorAll(INPUT_SELECTORS) : [];
    for (const el of els) {
      if (isUsableInput(el) && !el._peAttached) results.push(el);
    }
    if (root.matches?.(INPUT_SELECTORS) && isUsableInput(root) && !root._peAttached) {
      results.push(root);
    }
  } catch {}
  return results;
}

function isUsableInput(el) {
  if (el.readOnly || el.disabled) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  // Defer size check — elements may not be laid out yet
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0 && (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT)) return false;
  return true;
}

function attach(el) {
  el._peAttached = true;

  el.addEventListener('focus',     onInputFocus);
  el.addEventListener('click',     onInputFocus); // catches already-focused inputs
  el.addEventListener('blur',      onInputBlur);
  el.addEventListener('input',     onInputChange);
  el.addEventListener('keydown',   onKeyDown);
}

// ─── Focus / Blur ─────────────────────────────────────────────────────────────
function onInputFocus(e) {
  if (!state.isEnabled) return;
  clearTimeout(state.hideTimeout);
  state.activeInput = e.currentTarget;
  showEnhanceButton(state.activeInput);
}

function onInputBlur(e) {
  const input = e.currentTarget;
  state.hideTimeout = setTimeout(() => {
    if (state.activeInput === input) {
      removeEnhanceButton();
      removeTemplateDropdown();
      state.activeInput = null;
    }
  }, BLUR_HIDE_DELAY_MS);
}

function onKeyDown(e) {
  if (e.key === 'Escape') removeTemplateDropdown();
}

// ─── Enhance Button ───────────────────────────────────────────────────────────
function showEnhanceButton(input) {
  removeEnhanceButton();

  const btn = document.createElement('button');
  btn.id = 'pe-enhance-btn';
  btn.className = 'pe-enhance-btn';
  btn.setAttribute('aria-label', 'Enhance prompt');
  btn.setAttribute('title', 'Enhance prompt');
  btn.innerHTML = starIcon() + '<span>Enhance</span>';

  document.body.appendChild(btn);
  state.enhanceButton = btn;

  positionButton(input);

  // Make draggable — also handles mousedown preventDefault to keep input focus
  const dragCleanup = makeDraggable(btn, () => {
    if (!state.isProcessing) handleEnhanceClick();
  });

  // Re-clamp position on viewport resize (scroll ignored when user has saved pos)
  const reposition = () => { if (state.enhanceButton) positionButton(input); };
  window.addEventListener('resize', reposition, { passive: true });

  btn._cleanup = () => {
    window.removeEventListener('resize', reposition);
    dragCleanup();
  };
}

function positionButton(input) {
  const btn = state.enhanceButton;
  if (!btn) return;

  const btnW = btn.offsetWidth || 28;
  const btnH = btn.offsetHeight || 28;
  const gap  = 8;

  // If the user has previously dragged the button to a custom position, honour it.
  // Still clamp to the current viewport in case the window was resized.
  if (state.savedBtnPos) {
    const top  = Math.max(gap, Math.min(state.savedBtnPos.top,  window.innerHeight - btnH - gap));
    const left = Math.max(gap, Math.min(state.savedBtnPos.left, window.innerWidth  - btnW - gap));
    btn.style.top  = `${top}px`;
    btn.style.left = `${left}px`;
    return;
  }

  // Auto-position: walk up the DOM from the raw input element (which in ChatGPT
  // is a thin contenteditable div) to the visible rounded container so we can
  // anchor to its top-right corner above the placeholder text.
  const inputRect = input.getBoundingClientRect();
  let containerRect = inputRect;

  let el = input.parentElement;
  for (let i = 0; i < 5 && el && el !== document.body; i++, el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > inputRect.height + 20 && r.height < window.innerHeight * 0.5) {
      containerRect = r;
      break;
    }
  }

  let top  = containerRect.top  + gap;
  let left = containerRect.right - btnW - gap;

  top  = Math.max(gap, Math.min(top,  window.innerHeight - btnH - gap));
  left = Math.max(gap, Math.min(left, window.innerWidth  - btnW - gap));

  btn.style.top  = `${top}px`;
  btn.style.left = `${left}px`;
}

// ─── Draggable Button ─────────────────────────────────────────────────────────
function makeDraggable(btn, onClickFn) {
  let pointerDown = false;
  let didDrag     = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // keep input focus — same as old handler
    pointerDown = true;
    didDrag     = false;
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = parseInt(btn.style.left) || 0;
    startTop  = parseInt(btn.style.top)  || 0;
  };

  const onMouseMove = (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!didDrag && Math.hypot(dx, dy) < 5) return; // ignore micro-movements
    didDrag = true;
    btn.classList.add('pe-dragging');

    const btnW = btn.offsetWidth;
    const btnH = btn.offsetHeight;
    const gap  = 4;
    const newLeft = Math.max(gap, Math.min(startLeft + dx, window.innerWidth  - btnW - gap));
    const newTop  = Math.max(gap, Math.min(startTop  + dy, window.innerHeight - btnH - gap));
    btn.style.left = `${newLeft}px`;
    btn.style.top  = `${newTop}px`;
  };

  const onMouseUp = () => {
    if (!pointerDown) return;
    pointerDown = false;
    btn.classList.remove('pe-dragging');

    if (didDrag) {
      const top  = parseInt(btn.style.top);
      const left = parseInt(btn.style.left);
      state.savedBtnPos = { top, left };
      chrome.storage.local.set({ enhanceBtnPosition: { top, left } }).catch(() => {});
      // Block the click event that fires immediately after mouseup on a drag
      btn.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true });
    }
  };

  const onClick = () => { if (!didDrag) onClickFn(); };

  btn.addEventListener('mousedown', onMouseDown);
  btn.addEventListener('click',     onClick);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // Return cleanup for when the button is removed
  return () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  };
}

function removeEnhanceButton() {
  if (state.enhanceButton) {
    state.enhanceButton._cleanup?.();
    state.enhanceButton.remove();
    state.enhanceButton = null;
  }
}

// ─── Template Shortcut Dropdown ───────────────────────────────────────────────
function onInputChange(e) {
  if (!state.isEnabled) return;
  handleTemplateDetection(e.currentTarget);
}

function handleTemplateDetection(input) {
  const text = getInputText(input);
  const cursorPos = getCursorPos(input);
  const before = text.slice(0, cursorPos);

  // Detect a `//word` pattern at the end of the text before the cursor
  const match = before.match(/\/\/(\w*)$/);
  if (!match) {
    removeTemplateDropdown();
    return;
  }

  const query = match[1].toLowerCase();
  const matches = state.templates.filter(
    (t) =>
      t.trigger.replace('//', '').toLowerCase().startsWith(query) ||
      t.name.toLowerCase().startsWith(query)
  );

  if (matches.length === 0) {
    removeTemplateDropdown();
    return;
  }

  showTemplateDropdown(input, matches, match[0]);
}

function showTemplateDropdown(input, templates, triggerText) {
  removeTemplateDropdown();

  const dropdown = document.createElement('div');
  dropdown.className = 'pe-template-dropdown';
  dropdown.setAttribute('role', 'listbox');

  for (const tpl of templates) {
    const item = document.createElement('div');
    item.className = 'pe-template-item';
    item.setAttribute('role', 'option');
    item.innerHTML = `
      <span class="pe-tpl-trigger">${escHtml(tpl.trigger)}</span>
      <span class="pe-tpl-name">${escHtml(tpl.name)}</span>
    `;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applyTemplate(input, tpl, triggerText);
      removeTemplateDropdown();
    });
    dropdown.appendChild(item);
  }

  document.body.appendChild(dropdown);
  state.templateDropdown = dropdown;

  const rect = input.getBoundingClientRect();
  // position:fixed — no scrollY offset needed
  dropdown.style.top      = `${rect.bottom + 4}px`;
  dropdown.style.left     = `${rect.left}px`;
  dropdown.style.minWidth = `${Math.min(280, rect.width)}px`;
}

function applyTemplate(input, template, triggerText) {
  const current = getInputText(input);
  const replaced = current.replace(triggerText, template.content);
  setInputText(input, replaced);
  input.focus();
}

function removeTemplateDropdown() {
  if (state.templateDropdown) {
    state.templateDropdown.remove();
    state.templateDropdown = null;
  }
}

// ─── Read / Write Input Text ──────────────────────────────────────────────────
function getInputText(input) {
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') return input.value;
  return input.innerText || input.textContent || '';
}

async function setInputText(input, text) {
  const tag = input.tagName;

  // ── textarea / input (React native setter) ───────────────────────────────
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(input, text); else input.value = text;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (err) {
      console.error('[PE] textarea failed:', err);
      return false;
    }
  }

  // ── contenteditable: ChatGPT (ProseMirror), Claude (Tiptap), Gemini ──────
  const originalText = getInputText(input).trim();

  input.focus();
  await rafPromise();

  // True success: editor now contains our text (exact), OR content changed
  // from what it was before AND is non-empty. Using exact match first because
  // "content changed" would fire false-positive if original === new text.
  const succeeded = () => {
    const after = getInputText(input).trim();
    return after === text.trim() || (after.length > 0 && after !== originalText);
  };

  // Strategy A — execCommand('selectAll') + execCommand('insertText').
  // ProseMirror (ChatGPT) and Tiptap/Lexical (Claude) both listen to the
  // native 'beforeinput' event that execCommand('insertText') fires, so
  // this updates their internal state correctly. selectAll via execCommand
  // is more reliable than a manual Range because the editor sees its own
  // select-all event and updates selection state accordingly.
  try {
    document.execCommand('selectAll', false, null);
    await rafPromise();
    document.execCommand('insertText', false, text);
    await rafPromise();
    if (succeeded()) { moveCursorToEnd(input); return true; }
  } catch (err) {
    console.warn('[PE] insertText failed:', err.message);
  }

  // Strategy B — DataTransfer synthetic paste (works for Gemini / Quill).
  // Fires a real ClipboardEvent with our text so the editor's paste handler
  // receives and applies it without touching the real clipboard.
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.execCommand('selectAll', false, null);
    await rafPromise();
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    await rafPromise();
    if (succeeded()) { moveCursorToEnd(input); return true; }
  } catch (err) {
    console.warn('[PE] DataTransfer paste failed:', err.message);
  }

  // Strategy C — real clipboard write + execCommand('paste').
  // Less reliable because writeText() needs the user-gesture context to
  // still be alive (it often isn't after an async API round-trip), but
  // kept as a third option for edge-case editors.
  try {
    await navigator.clipboard.writeText(text);
    document.execCommand('selectAll', false, null);
    await rafPromise();
    document.execCommand('paste');
    await rafPromise();
    if (succeeded()) { moveCursorToEnd(input); return true; }
  } catch (err) {
    console.warn('[PE] clipboard+paste failed:', err.message);
  }

  // Strategy D — direct innerText mutation (last resort).
  // Bypasses framework state — the editor may not register this as a user
  // edit, but it at least puts the text in the DOM.
  try {
    input.innerText = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    moveCursorToEnd(input);
    return true;
  } catch (err) {
    console.error('[PE] innerText failed:', err.message);
  }

  return false;
}

// Wrap requestAnimationFrame in a Promise for use with async/await
function rafPromise() {
  return new Promise(requestAnimationFrame);
}

function selectAllContent(input) {
  const range = document.createRange();
  range.selectNodeContents(input);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function moveCursorToEnd(input) {
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function getCursorPos(input) {
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    return input.selectionStart ?? input.value.length;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return getInputText(input).length;
  return sel.getRangeAt(0).startOffset;
}

// ─── Enhance Action ───────────────────────────────────────────────────────────
async function handleEnhanceClick() {
  if (!state.activeInput) return;

  const targetInput = state.activeInput;
  const rawPrompt   = getInputText(targetInput).trim();

  if (!rawPrompt) {
    showToast('Please type a prompt first.', 'info');
    return;
  }

  // Guard: extension was reloaded/updated while this tab was open.
  // The content script is orphaned — chrome.runtime calls will throw.
  // Tell the user to refresh rather than showing a confusing error.
  if (!isContextAlive()) {
    showToast('Extension was updated — please refresh the page (F5).', 'info');
    return;
  }

  state.isProcessing = true;
  setButtonLoading(true);

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ENHANCE_PROMPT',
      payload: { prompt: rawPrompt, settings: state.settings },
    });

    if (!result) {
      showToast('No response from extension. Refresh the page and try again.', 'error');
      return;
    }

    if (result.error) {
      showToast(result.error, 'error');
      return;
    }

    // Auto-replace the text in the input — no modal step needed
    await rafPromise();
    targetInput.focus();
    await rafPromise();

    const ok = await setInputText(targetInput, result.optimizedPrompt);

    // Save to history for every successful enhancement — regardless of whether
    // text replaced directly or fell back to clipboard. Enhancement happened either way.
    chrome.runtime.sendMessage({
      type: 'SAVE_ENHANCEMENT',
      payload: {
        rawPrompt,
        optimizedPrompt: result.optimizedPrompt,
        useCase: result.useCase,
        scores: result.scores,
        timestamp: Date.now(),
      },
    }).catch(() => {});

    if (ok) {
      showActionToast(rawPrompt, result, targetInput);
    } else {
      await copyToClipboard(result.optimizedPrompt).catch(() => {});
      showToast('Copied to clipboard — press Ctrl+V to paste.', 'info');
    }
  } catch (err) {
    const isInvalidated = err?.message?.includes('Extension context invalidated') ||
                          err?.message?.includes('context invalidated');
    if (isInvalidated) {
      showToast('Extension was updated — please refresh the page (F5).', 'info');
    } else {
      showToast('Enhancement failed. Check your API key in the popup.', 'error');
      console.error('[PE] enhance error:', err);
    }
  } finally {
    state.isProcessing = false;
    setButtonLoading(false);
  }
}

function setButtonLoading(loading) {
  const btn = state.enhanceButton;
  if (!btn) return;
  if (loading) {
    btn.innerHTML = spinnerIcon() + '<span>Enhancing…</span>';
    btn.disabled = true;
    btn.classList.add('pe-loading');
  } else {
    btn.innerHTML = starIcon() + '<span>Enhance</span>';
    btn.disabled = false;
    btn.classList.remove('pe-loading');
  }
}

// ─── Result Modal ─────────────────────────────────────────────────────────────
function showModal(originalPrompt, result, targetInput) {
  removeModal();

  const { optimizedPrompt, originalScores, scores: enhancedScores, missingInfo, summary } = result;

  const overlay = document.createElement('div');
  overlay.className = 'pe-overlay';

  const modal = document.createElement('div');
  modal.className = 'pe-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Enhanced Prompt');

  modal.innerHTML = `
    <div class="pe-modal-header">
      <div class="pe-modal-title">
        ${starIcon(18)} Prompt Enhanced
        ${result.usedReflection ? '<span class="pe-reflect-badge">2-step analysis</span>' : ''}
      </div>
      <button class="pe-modal-close" id="pe-close-btn" aria-label="Close">
        ${closeIcon()}
      </button>
    </div>

    <div class="pe-modal-body">
      ${summary ? `
        <div class="pe-summary-banner">
          ${infoIcon()} <span>${escHtml(summary)}</span>
        </div>
      ` : ''}

      ${result.gradientReport ? `
        <details class="pe-gradient-details">
          <summary class="pe-gradient-summary">View quality analysis</summary>
          <pre class="pe-gradient-body">${escHtml(result.gradientReport)}</pre>
        </details>
      ` : ''}

      ${buildCoverageRow(result)}

      <div class="pe-prompts-grid">
        <div class="pe-prompt-col">
          <div class="pe-prompt-label">Original</div>
          <div class="pe-prompt-box pe-original">${escHtml(originalPrompt)}</div>
        </div>
        <div class="pe-prompts-divider">→</div>
        <div class="pe-prompt-col">
          <div class="pe-prompt-label">Enhanced</div>
          <div class="pe-prompt-box pe-enhanced">${escHtml(optimizedPrompt)}</div>
        </div>
      </div>

      ${buildScoresSection(originalScores, enhancedScores)}

      ${missingInfo?.length ? `
        <div class="pe-missing">
          <div class="pe-missing-label">${warnIcon()} Fill these placeholders for best results:</div>
          <div class="pe-missing-tags">
            ${missingInfo.map((m) => `<span class="pe-tag">${escHtml(m)}</span>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <div class="pe-modal-footer">
      <button class="pe-btn pe-btn-ghost" id="pe-cancel-btn">${closeIcon(14)} Cancel</button>
      <button class="pe-btn pe-btn-secondary" id="pe-copy-btn">${copyIcon()} Copy</button>
      <button class="pe-btn pe-btn-primary" id="pe-replace-btn">${checkIcon()} Replace Prompt</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  state.modal = overlay;

  // Wire buttons
  overlay.querySelector('#pe-close-btn').addEventListener('click', removeModal);
  overlay.querySelector('#pe-cancel-btn').addEventListener('click', removeModal);

  overlay.querySelector('#pe-copy-btn').addEventListener('click', () => {
    copyToClipboard(optimizedPrompt)
      .then(() => showToast('Copied to clipboard!'))
      .catch(() => showToast('Copy failed — please copy manually.', 'error'));
  });

  overlay.querySelector('#pe-replace-btn').addEventListener('click', async () => {
    const input = targetInput || state.activeInput;
    removeModal();

    if (!input) {
      await copyToClipboard(optimizedPrompt).catch(() => {});
      showToast('Input not found — prompt copied to clipboard. Paste with Ctrl+V.', 'error');
      return;
    }

    // Let the modal finish removing from the DOM before interacting with the input
    await rafPromise();

    try {
      const ok = await setInputText(input, optimizedPrompt);
      if (ok) {
        showToast('Prompt replaced!');
      } else {
        await copyToClipboard(optimizedPrompt).catch(() => {});
        showToast('Copied to clipboard — click the input and press Ctrl+V.', 'info');
      }
    } catch (err) {
      console.error('[PE] replace error:', err);
      await copyToClipboard(optimizedPrompt).catch(() => {});
      showToast('Copied to clipboard — click the input and press Ctrl+V.', 'info');
    }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) removeModal(); });

  const escHandler = (e) => {
    if (e.key === 'Escape') { removeModal(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Trap focus within modal
  modal.querySelector('#pe-replace-btn')?.focus();
}

function buildCoverageRow(result) {
  const score   = result.coverageScore;
  const leakage = result.leakageRisk || result.localLeakageWarning;
  if (score === null && !leakage) return '';

  const coverageHtml = score !== null ? (() => {
    const colour = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
    const label  = score >= 80 ? 'Good' : score >= 60 ? 'Partial' : 'Low';
    return `
      <div class="pe-coverage-row">
        <span class="pe-coverage-label">Intent Coverage</span>
        <div class="pe-coverage-bar">
          <div class="pe-coverage-fill" style="width:${score}%;background:${colour}"></div>
        </div>
        <span class="pe-coverage-pct" style="color:${colour}">${score}% ${label}</span>
      </div>`;
  })() : '';

  const leakageHtml = leakage ? `
    <div class="pe-leakage-badge">
      ${warnIcon()} Shallow rewrite detected — enhanced prompt is very similar to the original
    </div>` : '';

  return `<div class="pe-signal-row">${coverageHtml}${leakageHtml}</div>`;
}

function buildScoresSection(original, enhanced) {
  if (!original && !enhanced) return '';

  const dims = [
    { key: 'clarity', label: 'Clarity' },
    { key: 'specificity', label: 'Specificity' },
    { key: 'completeness', label: 'Completeness' },
    { key: 'tokenEfficiency', label: 'Token Efficiency' },
    { key: 'actionability', label: 'Actionability' },
  ];

  const rows = dims.map(({ key, label }) => {
    const o = original?.[key] ?? 0;
    const e = enhanced?.[key] ?? 0;
    const diff = e - o;
    const diffLabel = diff > 0 ? `+${diff}` : `${diff}`;
    const diffCls = diff > 0 ? 'pe-diff-up' : diff < 0 ? 'pe-diff-down' : 'pe-diff-neutral';

    return `
      <div class="pe-score-row">
        <span class="pe-score-name">${label}</span>
        <div class="pe-score-track">
          <div class="pe-score-bar pe-bar-before" style="width:${o * 10}%"></div>
        </div>
        <span class="pe-score-num">${o}</span>
        <span class="pe-score-arrow">→</span>
        <div class="pe-score-track">
          <div class="pe-score-bar pe-bar-after" style="width:${e * 10}%"></div>
        </div>
        <span class="pe-score-num">${e}</span>
        <span class="pe-score-diff ${diffCls}">${diffLabel}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="pe-scores">
      <div class="pe-scores-header">
        <span>Score Comparison</span>
        <div class="pe-scores-legend">
          <span class="pe-legend pe-legend-before">Before</span>
          <span class="pe-legend pe-legend-after">After</span>
        </div>
      </div>
      ${rows}
    </div>
  `;
}

function removeModal() {
  if (state.modal) {
    state.modal.remove();
    state.modal = null;
  }
}

// ─── Action Toast (auto-replace feedback) ────────────────────────────────────
function showActionToast(originalPrompt, result, targetInput) {
  document.getElementById('pe-action-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'pe-action-toast';
  toast.className = 'pe-action-toast';
  const useCaseLabels = { code: '💻 Code', job: '💼 Job', brainstorm: '🚀 Brainstorm', general: '⚡ General' };
  const ucLabel = useCaseLabels[result.useCase] || '';
  toast.innerHTML = `
    <span class="pe-action-msg">${starIcon(13)} Prompt enhanced!${ucLabel ? ` <span class="pe-uc-badge">${ucLabel}</span>` : ''}</span>
    <div class="pe-action-btns">
      <button class="pe-action-btn" id="pe-undo-btn">Undo</button>
      <button class="pe-action-btn pe-action-btn-primary" id="pe-details-btn">Details</button>
    </div>
  `;

  document.body.appendChild(toast);

  // Auto-dismiss after 6 s
  const timer = setTimeout(() => dismissActionToast(), 6000);

  toast.querySelector('#pe-undo-btn').addEventListener('click', async () => {
    clearTimeout(timer);
    dismissActionToast();
    await rafPromise();
    targetInput.focus();
    await rafPromise();
    await setInputText(targetInput, originalPrompt);
    showToast('Prompt restored.');
  });

  toast.querySelector('#pe-details-btn').addEventListener('click', () => {
    clearTimeout(timer);
    dismissActionToast();
    showModal(originalPrompt, result, targetInput);
  });
}

function dismissActionToast() {
  const t = document.getElementById('pe-action-toast');
  if (t) { t.classList.add('pe-toast-out'); setTimeout(() => t.remove(), 300); }
}

// ─── Clipboard ───────────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  // Try the modern API first
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}

  // Fallback: hidden textarea + execCommand (works in all content script contexts)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('execCommand copy failed');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  document.getElementById('pe-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'pe-toast';
  toast.className = `pe-toast pe-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('pe-toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────
function starIcon(size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}
function spinnerIcon() {
  return `<svg class="pe-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
}
function closeIcon(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
}
function checkIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
}
function copyIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
}
function infoIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
}
function warnIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Default Templates ────────────────────────────────────────────────────────
function getDefaultTemplates() {
  return [
    {
      id: 'summarize',
      trigger: '//summarize',
      name: 'Summarize',
      content: 'Summarize the following in [NUMBER] bullet points, focusing on [KEY_ASPECT]:\n\n[PASTE_CONTENT_HERE]',
    },
    {
      id: 'explain',
      trigger: '//explain',
      name: 'Explain',
      content: 'Explain [CONCEPT] as if I am a [AUDIENCE_LEVEL]. Use simple language and provide 2–3 concrete examples.',
    },
    {
      id: 'email',
      trigger: '//email',
      name: 'Write Email',
      content: 'Write a professional email to [RECIPIENT] about [SUBJECT].\nTone: [FORMAL/CASUAL]\nKey points to cover: [POINTS]\nDesired length: [SHORT/MEDIUM/LONG]',
    },
    {
      id: 'code',
      trigger: '//code',
      name: 'Code Help',
      content: 'Write [LANGUAGE] code that [TASK_DESCRIPTION]. Requirements:\n- [REQUIREMENT_1]\n- [REQUIREMENT_2]\nInclude inline comments and handle edge cases.',
    },
    {
      id: 'research',
      trigger: '//research',
      name: 'Research',
      content: 'Research [TOPIC] and provide:\n1. Overview\n2. Key findings\n3. Pros and cons\n4. Recommendations\n\nFocus especially on: [SPECIFIC_ASPECT]',
    },
    {
      id: 'rewrite',
      trigger: '//rewrite',
      name: 'Rewrite',
      content: 'Rewrite the following text to be [STYLE/TONE]. Keep the original meaning intact but improve [CLARITY/CONCISENESS/FLOW]:\n\n[PASTE_TEXT_HERE]',
    },
  ];
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
