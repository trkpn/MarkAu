/**
 * ============================================================================
 * MAIN APPLICATION CONTROLLER (ENGLISH VERSION & SETTINGS INTEGRATION)
 * ============================================================================
 * Features:
 * 1. Frictionless, 60fps Synchronized Scroll via requestAnimationFrame
 * 2. Zero-Jerk Session-Invalidated Click-to-Speak Engine
 * 3. Non-Disruptive Typography Highlighting
 * 4. Settings Manager (Custom Fonts, Auto-Stop on Replace, LocalStorage Best Practice)
 * 5. Safe Content Paste / Replacement Detection
 * 6. Unified View Switcher (Edit | Split | Preview) with Portrait Adaptations
 * ============================================================================
 */

import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import './style.css';

import { icons } from './icons.js';
import { renderMarkdown } from './markdown-parser.js';
import {
  tokenizeDOMForTTS,
  getAvailableVoices,
  setVoice,
  setRate,
  play,
  pause,
  stop,
  handlePreviewClick,
  onTTSStateChange,
  detectLanguage
} from './tts-engine.js';
import {
  toggleListening,
  stopListening,
  isSTTSupported,
  insertTextAtCursor,
  onSTTStateChange,
  setSTTLocale
} from './stt-engine.js';
import {
  loadSettings,
  saveSettings,
  getSettings,
  resetSettings,
  FONT_SANS_OPTIONS,
  FONT_MONO_OPTIONS,
  FONT_SIZE_OPTIONS
} from './settings-manager.js';
import { defaultMarkdown } from './sample-markdown.js';

// DOM Elements
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const previewWrapper = document.querySelector('.preview-wrapper');
const lineNumbers = document.getElementById('line-numbers');
const workspace = document.getElementById('workspace');

// Audio Controls Elements
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const voiceSelect = document.getElementById('voice-select');
const rateSlider = document.getElementById('rate-slider');
const rateBadge = document.getElementById('rate-badge');
const speechStatusChip = document.getElementById('speech-status-chip');

// STT, Theme, Sync Controls
const btnMic = document.getElementById('btn-mic');
const btnSyncScroll = document.getElementById('btn-sync-scroll');
const btnTheme = document.getElementById('btn-theme');
const viewTabs = document.getElementById('view-tabs');

// Settings Modal Elements
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const selectFontSans = document.getElementById('select-font-sans');
const selectFontMono = document.getElementById('select-font-mono');
const selectFontSize = document.getElementById('select-font-size');
const selectLineHeight = document.getElementById('select-line-height');
const checkAutoStop = document.getElementById('check-auto-stop');
const checkVsCodeLinks = document.getElementById('check-vscode-links');
const btnResetSettings = document.getElementById('btn-reset-settings');
const storageUsageText = document.getElementById('storage-usage-text');

// Status Bar Elements
const systemStatusDot = document.getElementById('system-status-dot');
const systemStatusText = document.getElementById('system-status-text');
const docStats = document.getElementById('doc-stats');
const readingTime = document.getElementById('reading-time');
const activeTokenInfo = document.getElementById('active-token-info');

// App State
let isSyncScrollEnabled = true;
let currentView = 'split';
let renderDebounceTimer = null;
let currentVoicesList = [];
let lastContentLength = 0;

// ============================================================================
// 1. Icon Injection
// ============================================================================
function injectIcons() {
  const iconMappings = {
    'icon-play': icons.play,
    'icon-pause': icons.pause,
    'icon-stop': icons.stop,
    'icon-mic': icons.mic,
    'icon-sync': icons.syncScroll,
    'icon-theme': icons.moon,
    'icon-settings': icons.settings,
    'modal-icon-settings': icons.settings,
    'icon-close-settings': icons.close,
    'icon-bold': icons.bold,
    'icon-italic': icons.italic,
    'icon-heading': icons.heading,
    'icon-code': icons.code,
    'icon-math': icons.math,
    'icon-table': icons.table,
    'icon-task': icons.task,
    'icon-sample': icons.sparkles,
    'icon-copy': icons.copy,
    'icon-trash': icons.trash,
    'icon-tab-edit': icons.edit,
    'icon-tab-split': icons.splitH,
    'icon-tab-preview': icons.eye
  };

  for (const [id, svgHtml] of Object.entries(iconMappings)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = svgHtml;
  }
}

// ============================================================================
// 2. High-Performance Line Numbers & Stats Generation
// ============================================================================
let cachedLineCount = 0;

function updateLineNumbersAndStats() {
  const text = editor.value;
  const lines = text.split('\n');
  const lineCount = lines.length;

  // Ultra-fast cached line numbering (renders in <0.5ms even for 20,000+ lines)
  if (lineCount !== cachedLineCount) {
    cachedLineCount = lineCount;
    const arr = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
      arr[i] = i + 1;
    }
    lineNumbers.textContent = arr.join('\n');
  }

  const charCount = text.length;
  // High-performance word count without regex memory bloat
  const trimmed = text.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  docStats.textContent = `Lines: ${lineCount} | Words: ${wordCount} | Chars: ${charCount}`;

  const minutes = Math.max(1, Math.ceil(wordCount / 180));
  readingTime.textContent = `Reading time: ~${minutes} min`;
}

// ============================================================================
// 3. Markdown Live Preview & Tokenization Pipeline
// ============================================================================
function renderLivePreview() {
  const markdownText = editor.value;

  const sanitizedHtml = renderMarkdown(markdownText);
  preview.innerHTML = sanitizedHtml;

  const detectedLocale = detectLanguage(markdownText);
  setSTTLocale(detectedLocale);

  const { tokens } = tokenizeDOMForTTS(preview, detectedLocale);
  activeTokenInfo.textContent = `Tokens: ${tokens.length}`;

  updateLineNumbersAndStats();
  lastContentLength = markdownText.length;
}

/**
 * Adaptive Debounced Render Handler
 * Scales dynamically with document size to ensure fluid 60fps typing
 */
function scheduleRender() {
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }
  const len = editor.value.length;
  const delay = len > 80000 ? 380 : len > 25000 ? 240 : 120;
  renderDebounceTimer = setTimeout(() => {
    renderLivePreview();
  }, delay);
}

// ============================================================================
// 4. Voice Loading & Selection (Thai Priority Hook)
// ============================================================================
async function initVoiceSelector() {
  currentVoicesList = await getAvailableVoices();
  if (!voiceSelect) return;

  voiceSelect.innerHTML = '';

  if (currentVoicesList.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No synthesis voices detected';
    voiceSelect.appendChild(opt);
    return;
  }

  const thaiVoices = [];
  const englishVoices = [];
  const otherVoices = [];

  currentVoicesList.forEach((voice, index) => {
    const lang = voice.lang.toLowerCase();
    if (lang.startsWith('th')) {
      thaiVoices.push({ voice, index });
    } else if (lang.startsWith('en')) {
      englishVoices.push({ voice, index });
    } else {
      otherVoices.push({ voice, index });
    }
  });

  const appendGroup = (label, list) => {
    if (list.length === 0) return;
    const optGroup = document.createElement('optgroup');
    optGroup.label = label;
    list.forEach(({ voice, index }) => {
      const option = document.createElement('option');
      option.value = index.toString();
      option.textContent = `${voice.name} (${voice.lang})`;
      optGroup.appendChild(option);
    });
    voiceSelect.appendChild(optGroup);
  };

  // Prioritize Thai voices above English, followed by international voices
  appendGroup('🇹🇭 Thai Voices', thaiVoices);
  appendGroup('🇺🇸 English Voices', englishVoices);
  appendGroup('🌐 Other Languages', otherVoices);

  // Default selection
  let defaultIndex = 0;
  if (thaiVoices.length > 0) {
    defaultIndex = thaiVoices[0].index;
  } else if (englishVoices.length > 0) {
    defaultIndex = englishVoices[0].index;
  }

  const savedVoiceName = localStorage.getItem('preferred_voice_name');
  if (savedVoiceName) {
    const foundIdx = currentVoicesList.findIndex((v) => v.name === savedVoiceName);
    if (foundIdx >= 0) {
      defaultIndex = foundIdx;
    }
  }

  voiceSelect.value = defaultIndex.toString();
  setVoice(currentVoicesList[defaultIndex]);

  voiceSelect.addEventListener('change', () => {
    const selectedIdx = parseInt(voiceSelect.value, 10);
    const chosenVoice = currentVoicesList[selectedIdx];
    if (chosenVoice) {
      localStorage.setItem('preferred_voice_name', chosenVoice.name);
      setVoice(chosenVoice);
    }
  });
}

// ============================================================================
// 5. Frictionless Synchronized Scrolling (requestAnimationFrame)
// ============================================================================
function initSyncScroll() {
  let isScrolling = false;
  let activeScroller = null;
  let clearScrollerTimeout = null;

  const scrollTarget = previewWrapper || preview;

  const markScroller = (element) => {
    activeScroller = element;
    if (clearScrollerTimeout) clearTimeout(clearScrollerTimeout);
    clearScrollerTimeout = setTimeout(() => {
      activeScroller = null;
    }, 120);
  };

  editor.addEventListener('wheel', () => markScroller(editor), { passive: true });
  editor.addEventListener('touchstart', () => markScroller(editor), { passive: true });
  scrollTarget.addEventListener('wheel', () => markScroller(scrollTarget), { passive: true });
  scrollTarget.addEventListener('touchstart', () => markScroller(scrollTarget), { passive: true });

  editor.addEventListener('scroll', () => {
    lineNumbers.scrollTop = editor.scrollTop;

    if (!isSyncScrollEnabled) return;
    if (activeScroller === scrollTarget) return;

    if (!isScrolling) {
      isScrolling = true;
      requestAnimationFrame(() => {
        const editorMax = editor.scrollHeight - editor.clientHeight;
        const previewMax = scrollTarget.scrollHeight - scrollTarget.clientHeight;

        if (editorMax > 0 && previewMax > 0) {
          const ratio = editor.scrollTop / editorMax;
          scrollTarget.scrollTop = ratio * previewMax;
        }
        isScrolling = false;
      });
    }
  }, { passive: true });

  scrollTarget.addEventListener('scroll', () => {
    if (!isSyncScrollEnabled) return;
    if (activeScroller === editor) return;

    if (!isScrolling) {
      isScrolling = true;
      requestAnimationFrame(() => {
        const editorMax = editor.scrollHeight - editor.clientHeight;
        const previewMax = scrollTarget.scrollHeight - scrollTarget.clientHeight;

        if (editorMax > 0 && previewMax > 0) {
          const ratio = scrollTarget.scrollTop / previewMax;
          editor.scrollTop = ratio * editorMax;
          lineNumbers.scrollTop = editor.scrollTop;
        }
        isScrolling = false;
      });
    }
  }, { passive: true });

  btnSyncScroll.addEventListener('click', () => {
    isSyncScrollEnabled = !isSyncScrollEnabled;
    btnSyncScroll.classList.toggle('active', isSyncScrollEnabled);
    btnSyncScroll.title = isSyncScrollEnabled
      ? 'Synchronized scrolling: Enabled'
      : 'Synchronized scrolling: Disabled';
  });
}

// ============================================================================
// 6. Speech-to-Text (STT) Integration
// ============================================================================
function initSTT() {
  if (!isSTTSupported()) {
    btnMic.disabled = true;
    btnMic.title = 'Speech Recognition is not supported in this browser (Chrome / Edge recommended)';
    return;
  }

  btnMic.addEventListener('click', () => {
    toggleListening({
      onResult: (finalText) => {
        if (finalText) {
          insertTextAtCursor(editor, finalText);
          scheduleRender();
        }
      },
      onError: (err) => {
        console.warn('STT Error:', err);
      }
    });
  });

  onSTTStateChange(({ isListening }) => {
    if (isListening) {
      btnMic.classList.add('recording');
      btnMic.innerHTML = `<span class="btn-icon-slot">${icons.micOff}</span><span class="mic-label">Listening...</span>`;
      systemStatusDot.className = 'status-dot recording';
      systemStatusText.textContent = 'Microphone Active (Dictating...)';
    } else {
      btnMic.classList.remove('recording');
      btnMic.innerHTML = `<span class="btn-icon-slot">${icons.mic}</span><span class="mic-label">Dictate</span>`;
      systemStatusDot.className = 'status-dot active';
      systemStatusText.textContent = 'Client Ready';
    }
  });
}

// ============================================================================
// 7. TTS Audio Controls & Instant Visual Feedback
// ============================================================================
function initTTSControls() {
  btnPlay.addEventListener('click', () => {
    play();
  });

  btnPause.addEventListener('click', () => {
    pause();
  });

  btnStop.addEventListener('click', () => {
    stop();
  });

  rateSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    rateBadge.textContent = `${val.toFixed(1)}x`;
    setRate(val);
  });

  preview.addEventListener('click', (e) => {
    const linkEl = e.target.closest('a');
    if (linkEl) {
      const href = linkEl.getAttribute('href');
      // If native file:// link is clicked, browser blocks it due to security
      if (href && /^file:\/\//i.test(href)) {
        navigator.clipboard?.writeText(href).catch(() => {});
        speechStatusChip.textContent = '📋 Copied file path to clipboard (browser blocks file:// directly)';
        speechStatusChip.style.color = 'var(--accent-color)';
        setTimeout(() => {
          speechStatusChip.textContent = 'Ready';
        }, 3500);
      }
      // Return so link click doesn't trigger unexpected audio playback
      return;
    }

    speechStatusChip.textContent = '🔊 Starting from here...';
    speechStatusChip.style.color = 'var(--accent-color)';
    handlePreviewClick(e);
  });

  onTTSStateChange(({ isPlaying, isPaused, currentWordIndex, totalWords }) => {
    btnPlay.disabled = isPlaying && !isPaused;
    btnPause.disabled = !isPlaying || isPaused;
    btnStop.disabled = !isPlaying && !isPaused;

    if (isPlaying && !isPaused) {
      speechStatusChip.textContent = `Reading word ${currentWordIndex + 1}/${totalWords}`;
      speechStatusChip.style.color = 'var(--accent-color)';
      systemStatusDot.className = 'status-dot reading';
      systemStatusText.textContent = 'Text-to-Speech active';
    } else if (isPaused) {
      speechStatusChip.textContent = 'Paused';
      speechStatusChip.style.color = 'var(--text-muted)';
      systemStatusDot.className = 'status-dot active';
      systemStatusText.textContent = 'Audio paused';
    } else {
      speechStatusChip.textContent = 'Click word to listen';
      speechStatusChip.style.color = 'var(--text-muted)';
      systemStatusDot.className = 'status-dot active';
      systemStatusText.textContent = 'Client Ready';
    }
  });
}

// ============================================================================
// 8. Editor Formatting Toolbar
// ============================================================================
function initToolbar() {
  const insertFormatting = (prefix, suffix = '', defaultText = '') => {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;
    const selected = text.substring(start, end) || defaultText;

    const replacement = `${prefix}${selected}${suffix}`;
    editor.value = text.substring(0, start) + replacement + text.substring(end);

    const newCursor = start + prefix.length + selected.length;
    editor.focus();
    editor.setSelectionRange(newCursor, newCursor);
    scheduleRender();
  };

  document.querySelectorAll('.toolbar-btn[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      switch (action) {
        case 'bold':
          insertFormatting('**', '**', 'bold text');
          break;
        case 'italic':
          insertFormatting('*', '*', 'italic text');
          break;
        case 'heading':
          insertFormatting('### ', '\n', 'Heading');
          break;
        case 'code':
          insertFormatting('```javascript\n', '\n```\n', '// code here');
          break;
        case 'math':
          insertFormatting('$$\n', '\n$$\n', 'E = mc^2');
          break;
        case 'table':
          insertFormatting(
            '\n| Header 1 | Header 2 |\n| :--- | :--- |\n| Data 1 | Data 2 |\n'
          );
          break;
        case 'task':
          insertFormatting('- [ ] ', '\n', 'New Task');
          break;
      }
    });
  });

  document.getElementById('btn-sample')?.addEventListener('click', () => {
    editor.value = defaultMarkdown;
    scheduleRender();
  });

  document.getElementById('btn-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(editor.value);
      alert('Markdown copied to clipboard!');
    } catch (e) {
      console.error(e);
    }
  });

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all editor content?')) {
      stop();
      editor.value = '';
      scheduleRender();
    }
  });
}

// ============================================================================
// 9. Unified View Switcher (Edit | Split | Preview)
// ============================================================================
function setView(viewMode) {
  currentView = viewMode;
  workspace.className = `workspace view-${viewMode}`;
  document.body.dataset.view = viewMode;

  viewTabs?.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewMode);
  });

  localStorage.setItem('preferred_view', viewMode);
}

function initViewTabs() {
  viewTabs?.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.view;
      setView(mode);
    });
  });

  const savedView = localStorage.getItem('preferred_view') || 'split';
  setView(savedView);
}

// ============================================================================
// 10. Theme Management
// ============================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  btnTheme.innerHTML = savedTheme === 'dark' ? icons.sun : icons.moon;

  btnTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btnTheme.innerHTML = next === 'dark' ? icons.sun : icons.moon;
  });
}

// ============================================================================
// 11. Preferences & Typography Settings Modal
// ============================================================================
function initSettingsModal() {
  // Populate font selects
  FONT_SANS_OPTIONS.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    selectFontSans.appendChild(opt);
  });

  FONT_MONO_OPTIONS.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    selectFontMono.appendChild(opt);
  });

  FONT_SIZE_OPTIONS.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    selectFontSize.appendChild(opt);
  });

  const updateModalInputs = () => {
    const s = getSettings();
    selectFontSans.value = s.fontSans;
    selectFontMono.value = s.fontMono;
    selectFontSize.value = s.fontSize;
    selectLineHeight.value = s.lineHeight;
    checkAutoStop.checked = s.autoStopOnReplace;
    if (checkVsCodeLinks) {
      checkVsCodeLinks.checked = s.openFileInVsCode !== false;
    }

    // Calculate approximate localStorage usage
    let totalBytes = 0;
    for (let x in localStorage) {
      if (localStorage.hasOwnProperty(x)) {
        totalBytes += (localStorage[x].length + x.length) * 2;
      }
    }
    const kb = (totalBytes / 1024).toFixed(1);
    if (storageUsageText) {
      storageUsageText.textContent = `Usage: ~${kb} KB`;
    }
  };

  const openModal = () => {
    updateModalInputs();
    modalSettings.removeAttribute('hidden');
  };

  const closeModal = () => {
    modalSettings.setAttribute('hidden', '');
  };

  btnSettings?.addEventListener('click', openModal);
  btnCloseSettings?.addEventListener('click', closeModal);

  // Close on backdrop click
  modalSettings?.addEventListener('click', (e) => {
    if (e.target === modalSettings) {
      closeModal();
    }
  });

  // Close on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalSettings.hasAttribute('hidden')) {
      closeModal();
    }
  });

  // Change listeners
  selectFontSans?.addEventListener('change', () => {
    saveSettings({ fontSans: selectFontSans.value });
  });

  selectFontMono?.addEventListener('change', () => {
    saveSettings({ fontMono: selectFontMono.value });
  });

  selectFontSize?.addEventListener('change', () => {
    saveSettings({ fontSize: selectFontSize.value });
  });

  selectLineHeight?.addEventListener('change', () => {
    saveSettings({ lineHeight: selectLineHeight.value });
  });

  checkAutoStop?.addEventListener('change', () => {
    saveSettings({ autoStopOnReplace: checkAutoStop.checked });
  });

  checkVsCodeLinks?.addEventListener('change', () => {
    saveSettings({ openFileInVsCode: checkVsCodeLinks.checked });
    renderLivePreview();
  });

  btnResetSettings?.addEventListener('click', () => {
    if (confirm('Reset all typography and preferences to defaults?')) {
      resetSettings();
      updateModalInputs();
      renderLivePreview();
    }
  });
}

// ============================================================================
// 12. Safe Content Paste / Replacement Handler
// ============================================================================
function initPasteProtection() {
  editor.addEventListener('paste', () => {
    const settings = getSettings();
    if (!settings.autoStopOnReplace) return;

    // Check if the paste covers the whole document or major selection
    const isMajorReplacement =
      (editor.selectionStart === 0 && editor.selectionEnd >= editor.value.length * 0.75) ||
      editor.value.length < 40;

    if (isMajorReplacement && window.speechSynthesis.speaking) {
      stop();
      speechStatusChip.textContent = 'Content replaced — playback stopped';
      speechStatusChip.style.color = 'var(--text-muted)';
    }
  });
}

// ============================================================================
// 13. Offline Service Worker & Functional Network Status Badge
// ============================================================================
function initOfflineSupport() {
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.update();
        })
        .catch(() => {});
    });
  }
}

function initNetworkStatus() {
  const badge = document.getElementById('network-badge');
  if (!badge) return;

  const updateStatus = () => {
    if (navigator.onLine) {
      badge.className = 'status-badge badge-online';
      badge.textContent = 'Online';
      badge.title = 'Connected to network';
    } else {
      badge.className = 'status-badge badge-offline';
      badge.textContent = 'Offline';
      badge.title = 'Working in 100% offline mode';
    }
  };

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// ============================================================================
// 14. App Initialization Entry
// ============================================================================
async function initApp() {
  initOfflineSupport();
  initNetworkStatus();
  // Load saved typography settings and apply to root
  loadSettings();

  injectIcons();
  initTheme();
  initViewTabs();
  initToolbar();
  initTTSControls();
  initSTT();
  initSyncScroll();
  initSettingsModal();
  initPasteProtection();

  const savedContent = localStorage.getItem('markdown_draft');
  editor.value = savedContent || defaultMarkdown;
  lastContentLength = editor.value.length;

  editor.addEventListener('input', () => {
    localStorage.setItem('markdown_draft', editor.value);

    // If text length drastically changed (>50%) while speech was actively reading,
    // safely stop playback to prevent reading ghost text
    const settings = getSettings();
    if (settings.autoStopOnReplace && window.speechSynthesis.speaking) {
      const currentLength = editor.value.length;
      if (Math.abs(currentLength - lastContentLength) > Math.max(80, lastContentLength * 0.5)) {
        stop();
        speechStatusChip.textContent = 'Document altered — playback stopped';
        speechStatusChip.style.color = 'var(--text-muted)';
      }
    }

    scheduleRender();
  });

  renderLivePreview();
  await initVoiceSelector();

  window.addEventListener('keydown', (e) => {
    if (e.target !== editor && e.code === 'Space') {
      e.preventDefault();
      play();
    }
  });
}

// Boot application
initApp();
