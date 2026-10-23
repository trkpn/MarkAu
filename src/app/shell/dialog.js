/**
 * ============================================================================
 * IN-APP CONFIRMATION DIALOG
 * ============================================================================
 * Replaces the native `alert()` / `confirm()` calls. A blocking native dialog
 * inside a single page app kills the flow, and `alert()` cannot be styled or
 * announced properly.
 * ============================================================================
 */

/**
 * Escapes text before it is injected into markup.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  );
}

/**
 * Shows a modal confirmation dialog.
 * @param {{ title: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false
}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    dialog.innerHTML = `
      <div class="modal-card max-w-sm">
        <div class="modal-header">
          <div class="modal-title"><h3>${escapeHtml(title)}</h3></div>
        </div>
        <div class="modal-body">
          <p class="text-sm leading-relaxed text-fg-2">${escapeHtml(message)}</p>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" class="btn btn-sm" data-role="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}" data-role="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    dialog.querySelector('[data-role="cancel"]').addEventListener('click', () => done(false));
    dialog.querySelector('[data-role="confirm"]').addEventListener('click', () => done(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      done(false);
    });

    dialog.showModal();
  });
}
