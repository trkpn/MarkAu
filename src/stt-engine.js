/**
 * ============================================================================
 * SPEECH-TO-TEXT (STT) ENGINE
 * ============================================================================
 * - Continuous/Interim recognition via Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
 * - Module-level persistent instance to eliminate Chromium Garbage Collection bugs
 * - Real-time text insertion at current cursor position or end of Markdown editor
 * - Clear listening indicator & microphone lifecycle state management
 * ============================================================================
 */

// Persistent Module-Scope reference for Chromium GC protection
let recognitionInstance = null;
let isListening = false;
let currentLocale = 'th-TH';

// Event listeners for UI updates
const stateListeners = new Set();

/**
 * Check if the browser supports Speech Recognition
 */
export function isSTTSupported() {
  return typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

/**
 * Register state listener
 */
export function onSTTStateChange(listener) {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function notifyState(detail = {}) {
  const state = {
    isListening,
    locale: currentLocale,
    ...detail
  };
  stateListeners.forEach((fn) => {
    try {
      fn(state);
    } catch (e) {
      console.error('STT State Listener Error:', e);
    }
  });
}

/**
 * Configures the recognition locale (e.g. 'th-TH', 'en-US')
 * @param {string} locale
 */
export function setSTTLocale(locale) {
  currentLocale = locale;
  if (recognitionInstance) {
    recognitionInstance.lang = locale;
  }
}

/**
 * Starts speech recognition
 * @param {Object} options
 * @param {(finalText: string, interimText: string) => void} options.onResult
 * @param {(err: any) => void} [options.onError]
 */
export function startListening({ onResult, onError } = {}) {
  if (!isSTTSupported()) {
    const err = new Error('Speech Recognition is not supported in this browser.');
    onError?.(err);
    return;
  }

  if (isListening && recognitionInstance) {
    return;
  }

  const SpeechRecognitionConstructor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  // Persist in module scope and window object
  recognitionInstance = new SpeechRecognitionConstructor();
  window.__currentSTTRecognition = recognitionInstance;

  recognitionInstance.continuous = true;
  recognitionInstance.interimResults = true;
  recognitionInstance.lang = currentLocale;
  recognitionInstance.maxAlternatives = 1;

  recognitionInstance.onstart = () => {
    isListening = true;
    notifyState({ isListening: true });
  };

  recognitionInstance.onresult = (event) => {
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const res = event.results[i];
      if (res.isFinal) {
        finalTranscript += res[0].transcript;
      } else {
        interimTranscript += res[0].transcript;
      }
    }

    onResult?.(finalTranscript, interimTranscript);
  };

  recognitionInstance.onerror = (event) => {
    console.warn('Speech Recognition Event Error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      stopListening();
    }
    onError?.(event);
    notifyState({ error: event.error });
  };

  recognitionInstance.onend = () => {
    // If user intended continuous dictation, we can decide whether to restart or stop
    isListening = false;
    notifyState({ isListening: false });
  };

  try {
    recognitionInstance.start();
  } catch (err) {
    console.error('Failed to start SpeechRecognition:', err);
    isListening = false;
    notifyState({ isListening: false, error: err.message });
    onError?.(err);
  }
}

/**
 * Stops speech recognition
 */
export function stopListening() {
  if (recognitionInstance) {
    try {
      recognitionInstance.stop();
    } catch (e) {
      // Ignore if already stopped
    }
    recognitionInstance = null;
    window.__currentSTTRecognition = null;
  }
  isListening = false;
  notifyState({ isListening: false });
}

/**
 * Toggles speech recognition
 * @param {Object} options
 */
export function toggleListening(options) {
  if (isListening) {
    stopListening();
  } else {
    startListening(options);
  }
}

/**
 * Inserts transcribed text into a HTMLTextAreaElement at current cursor position
 * or appends to the end if cursor is undefined.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} textToInsert
 */
export function insertTextAtCursor(textarea, textToInsert) {
  if (!textarea || !textToInsert) return;

  const startPos = textarea.selectionStart ?? textarea.value.length;
  const endPos = textarea.selectionEnd ?? textarea.value.length;
  const originalValue = textarea.value;

  // Add leading space if needed
  let insertText = textToInsert;
  if (startPos > 0 && originalValue[startPos - 1] !== ' ' && originalValue[startPos - 1] !== '\n') {
    insertText = ' ' + insertText;
  }

  const newValue =
    originalValue.substring(0, startPos) +
    insertText +
    originalValue.substring(endPos);

  textarea.value = newValue;

  // Move cursor to after the inserted text
  const newCursorPos = startPos + insertText.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();

  // Dispatch standard input event so markdown preview reacts
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
