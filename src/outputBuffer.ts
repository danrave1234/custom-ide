// outputBuffer.ts — process ANSI control sequences and collapse repeated
// TypeScript/NestJS watch status blocks so the run output drawer stays readable.

import type { OutputLine } from "./types";

// --- ANSI control sequence detection ---

// ESC [ 2 J  (clear screen)  /  ESC [ ; J  /  ESC [ 0 J  /  ESC [ 1 J
const CLEAR_SCREEN_RE = /\x1b\[[012]?[JH]/;

// ESC [ n A  (cursor up n lines, n defaults to 1)
const CURSOR_UP_RE = /\x1b\[([0-9]*)A/;

// ESC [ n B  (cursor down — less common in watch output, but handle it)
const CURSOR_DOWN_RE = /\x1b\[([0-9]*)B/;

// ESC [ 2 K  (erase entire line) / ESC [ K
const CLEAR_LINE_RE = /\x1b\[([0-2])?K/;

// Form feed / carriage return + line feed
const FORM_FEED_RE = /\f/;

// ESC c  (RIS — reset to initial state, treat as clear) — case-insensitive
const RIS_RE = /\x1b[cC]/;

// --- NestJS / TypeScript watch status block detection ---

// Watch blocks start with one of these markers:
//   "File change detected. Starting incremental compilation..."
//   "Starting compilation in watch mode..."
//   "ts-node: waiting for file changes..."
// They end with a status line like:
//   "Found 0 errors. Watching for file changes."
//   "Found 1 error. Watching for file changes."
//   "Waiting for changes..."

const WATCH_START_RE =
  /^(?:File change detected|Starting compilation in watch mode|ts-node: waiting for file changes)/i;

const WATCH_END_RE =
  /^(?:Found \d+ error|Waiting for changes)/i;

// --- Helpers ---

/**
 * Strip all ANSI escape sequences from a string, leaving only the visible text.
 * Keeps SGR color codes out too — this is for the "plain text" version used in
 * pattern matching.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

/**
 * Check if a line contains a clear-screen ANSI sequence (not clear-line).
 */
function hasClearScreenSequence(text: string): boolean {
  return CLEAR_SCREEN_RE.test(text) || FORM_FEED_RE.test(text) || RIS_RE.test(text);
}

/**
 * Check if a line is a pure clear-line sequence with no other content.
 */
function isPureClearLine(text: string): boolean {
  return CLEAR_LINE_RE.test(text) && !stripAnsi(text).trim();
}

/**
 * Extract the number of cursor-up moves from a line.
 * Returns 0 if no cursor-up sequence found.
 */
function getCursorUpCount(text: string): number {
  const match = CURSOR_UP_RE.exec(text);
  if (!match) return 0;
  return match[1] ? parseInt(match[1], 10) : 1;
}

/**
 * Extract the number of cursor-down moves from a line.
 */
function getCursorDownCount(text: string): number {
  const match = CURSOR_DOWN_RE.exec(text);
  if (!match) return 0;
  return match[1] ? parseInt(match[1], 10) : 1;
}

/**
 * Strip ANSI control sequences from a line but preserve SGR color codes.
 * This is the visible text that will be rendered.
 */
function stripControlsPreserveSgr(text: string): string {
  // Remove cursor movement, clear, etc. but keep SGR (color) codes
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/\x1b\[[0-9;?]*[A-LN-Za-ln-z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // Also strip standalone ESC sequences (RIS, etc.) that aren't CSI
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[^[\]][^m]*/g, "")
    .replace(/\r/g, "");
}

// --- Main API ---

/**
 * Append new output lines to an existing output buffer, processing ANSI control
 * sequences and collapsing repeated watch status blocks.
 *
 * Handles:
 * - Clear screen (ESC[2J, ESC[K, form feed, ESC[c): removes all non-system lines
 * - Cursor up (ESC[nA): removes up to n trailing non-system lines
 * - Cursor down (ESC[nB): adjusts cursor position (less common)
 * - Clear line (ESC[2K): strips the line content
 * - Watch status collapse: replaces the last TypeScript/NestJS watch block
 *   instead of appending a duplicate
 *
 * @param existing  The current output lines (may be empty)
 * @param incoming  New lines to append
 * @returns The processed output lines
 */
export function appendRunOutput(existing: OutputLine[], incoming: OutputLine[]): OutputLine[] {
  let result = [...existing];

  for (const line of incoming) {
    const { text, stream } = line;
    const plain = stripAnsi(text);

    // --- Clear screen / form feed / RIS ---
    const isClearScreen = hasClearScreenSequence(text);
    if (isClearScreen) {
      // Keep system lines, drop everything else
      result = result.filter((l) => l.stream === "system");
      // If the line itself has visible content after stripping controls, add it
      const cleaned = stripControlsPreserveSgr(text);
      if (cleaned.trim()) {
        result.push({ text: cleaned, stream });
      }
      continue;
    }

    // --- Pure clear line — skip it ---
    if (isPureClearLine(text)) {
      continue;
    }

    // --- Cursor up ---
    const upCount = getCursorUpCount(text);
    if (upCount > 0) {
      // Remove up to `upCount` trailing non-system lines
      let removed = 0;
      while (removed < upCount && result.length > 0) {
        const last = result[result.length - 1];
        if (last.stream === "system") break; // Don't remove system lines
        result.pop();
        removed++;
      }
      // If the line has visible content, add it
      const cleaned = stripControlsPreserveSgr(text);
      if (cleaned.trim()) {
        result.push({ text: cleaned, stream });
      }
      continue;
    }

    // --- Cursor down (rare, but handle it) ---
    const downCount = getCursorDownCount(text);
    if (downCount > 0) {
      // For cursor down, we just add empty lines (or the content if any)
      const cleaned = stripControlsPreserveSgr(text);
      if (cleaned.trim()) {
        result.push({ text: cleaned, stream });
      }
      continue;
    }

    // --- Watch status block collapse ---
    if (WATCH_START_RE.test(plain)) {
      // This starts a new watch block — remove the previous one
      result = removeLastWatchBlock(result);
    }

    // --- Normal line ---
    const cleaned = stripControlsPreserveSgr(text);
    if (cleaned || stream === "system") {
      // Watch end lines replace the previous watch end line if present
      if (WATCH_END_RE.test(plain)) {
        result = removeLastWatchEndLine(result);
      }
      result.push({ text: cleaned || text, stream });
    }
  }

  return result;
}

/**
 * Remove the last TypeScript/NestJS watch status block from the output.
 * A watch block starts with a WATCH_START_RE line and ends with a WATCH_END_RE line.
 * We remove from the last WATCH_START_RE line through the end (or the next WATCH_END_RE).
 */
function removeLastWatchBlock(lines: OutputLine[]): OutputLine[] {
  // Find the last watch start line
  let startIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const plain = stripAnsi(lines[i].text);
    if (WATCH_START_RE.test(plain)) {
      startIndex = i;
      break;
    }
    // Stop if we hit a system line or another watch start
    if (lines[i].stream === "system") break;
  }

  if (startIndex >= 0) {
    return lines.slice(0, startIndex);
  }
  return lines;
}

/**
 * Remove the last watch end line (e.g. "Found 0 errors. Watching for file changes.")
 * so we can replace it with the updated one.
 */
function removeLastWatchEndLine(lines: OutputLine[]): OutputLine[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    const plain = stripAnsi(lines[i].text);
    if (WATCH_END_RE.test(plain)) {
      return lines.slice(0, i);
    }
    if (lines[i].stream === "system") break;
  }
  return lines;
}
