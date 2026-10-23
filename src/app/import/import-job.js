/**
 * ============================================================================
 * IMPORT JOBS
 * ============================================================================
 * Opening a large file is one long piece of work with several stages. A new
 * import must be able to cancel the old one before its late answer replaces
 * the document the reader is now looking at.
 * ============================================================================
 */

import { setMessage } from '@/app/shell/status.js';

let currentJob = null;
let sequence = 0;

/**
 * Starts an import job and cancels the one that came before it.
 *
 * @param {string} label what is being imported
 * @param {string} [kind] what owns the work — the URL dialog uses 'url'
 * @returns {{ id: number, label: string, kind: string, controller: AbortController, signal: AbortSignal }}
 */
export function beginImport(label = 'Document', kind = 'generic') {
  currentJob?.controller.abort();

  const controller = new AbortController();
  sequence += 1;

  const job = {
    id: sequence,
    label,
    kind,
    controller,
    signal: controller.signal
  };

  currentJob = job;
  return job;
}

/**
 * @returns {string|null} the kind of the job that is current now
 */
export function currentImportKind() {
  return currentJob?.kind || null;
}

/**
 * @param {object|null} job
 * @returns {boolean} whether the job is the one that is still wanted
 */
export function isCurrentImport(job) {
  return Boolean(job) && currentJob === job && !job.signal.aborted;
}

/**
 * Finishes a job when it is still the current one.
 *
 * @param {object|null} job
 * @returns {boolean} whether this job was the current one
 */
export function endImport(job) {
  if (!job || currentJob !== job) return false;
  currentJob = null;
  return true;
}

/**
 * Cancels the import that is running, if there is one.
 *
 * @param {string|null} [kind] only cancel a job of this kind; the URL dialog
 *   passes 'url' so closing it cannot stop a document opened elsewhere
 */
export function cancelImport(kind = null) {
  if (!currentJob) return;
  if (kind && currentJob.kind !== kind) return;
  currentJob.controller.abort();
  currentJob = null;
}

/**
 * Shows a stage of the running import in the status bar.
 *
 * @param {object|null} job
 * @param {{ phase?: string, done?: number, total?: number }} progress
 */
export function showImportProgress(job, progress = {}) {
  if (!isCurrentImport(job)) return;

  const label = job.label ? `${job.label} — ` : '';
  const phase = progress.phase || 'Working';
  const counted =
    Number.isFinite(progress.done) && Number.isFinite(progress.total) && progress.total > 0
      ? ` ${progress.done}/${progress.total}`
      : '';

  const text = `${label}${phase}${counted}…`;
  setMessage(text, { tone: 'muted' });
}
