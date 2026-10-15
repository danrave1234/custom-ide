// outputBuffer.test.ts — unit tests for the output buffer logic
// Run with: node --import tsx scripts/outputBuffer.test.mjs
// Or: npx tsx src/outputBuffer.test.ts

import { appendRunOutput } from "./outputBuffer";
import type { OutputLine } from "./types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function lines(...texts: string[]): OutputLine[] {
  return texts.map((t) => ({ text: t, stream: "stdout" as const }));
}

function systemLines(...texts: string[]): OutputLine[] {
  return texts.map((t) => ({ text: t, stream: "system" as const }));
}

// --- Test: Clear screen removes non-system lines ---
console.log("\nClear screen:");
{
  const existing = [
    ...systemLines("▶ npm run start"),
    ...lines("Hello", "World"),
  ];
  const incoming = lines("\x1b[2J"); // ESC[2J clear screen
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 1, "Only system line remains after clear screen");
  assert(result[0].text === "▶ npm run start", "System line preserved");
}

// --- Test: Clear screen with visible content ---
console.log("\nClear screen with content:");
{
  const existing = lines("Old line");
  const incoming = lines("\x1b[2JNew content");
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 1, "Only new content after clear screen");
  assert(result[0].text === "New content", "Visible content preserved");
}

// --- Test: Cursor up removes trailing lines ---
console.log("\nCursor up:");
{
  const existing = lines("Line 1", "Line 2", "Line 3");
  const incoming = lines("\x1b[2A"); // ESC[2A cursor up 2
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 1, "Two lines removed by cursor up");
  assert(result[0].text === "Line 1", "First line remains");
}

// --- Test: Cursor up stops at system lines ---
console.log("\nCursor up stops at system lines:");
{
  const existing = [
    ...systemLines("▶ command"),
    ...lines("Line 1", "Line 2"),
  ];
  const incoming = lines("\x1b[5A"); // ESC[5A cursor up 5 (more than available)
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 1, "System line not removed by cursor up");
  assert(result[0].stream === "system", "System line preserved");
}

// --- Test: Cursor up with content ---
console.log("\nCursor up with content:");
{
  const existing = lines("Line 1", "Line 2");
  const incoming = lines("\x1b[1AUpdated"); // ESC[1A cursor up 1 + content
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 2, "One line replaced by cursor up + content");
  assert(result[0].text === "Line 1", "First line unchanged");
  assert(result[1].text === "Updated", "Second line replaced with new content");
}

// --- Test: Watch status block collapse ---
console.log("\nWatch status block collapse:");
{
  const existing = [
    ...systemLines("▶ npm run start:dev"),
    ...lines(
      "File change detected. Starting incremental compilation...",
      "ts-node: nightly watching for file changes...",
      "Found 0 errors. Watching for file changes."
    ),
  ];
  const incoming = lines(
    "File change detected. Starting incremental compilation...",
    "ts-node: nightly watching for file changes...",
    "Found 1 error. Watching for file changes."
  );
  const result = appendRunOutput(existing, incoming);

  // Should have: system line + new watch block (3 lines)
  assert(result.length === 4, "Old watch block replaced by new one");
  assert(result[0].stream === "system", "System line preserved");
  assert(result[3].text.includes("Found 1 error"), "New error count present");
}

// --- Test: Watch end line replacement ---
console.log("\nWatch end line replacement:");
{
  const existing = lines(
    "Some output",
    "Found 0 errors. Watching for file changes."
  );
  const incoming = lines("Found 2 errors. Watching for file changes.");
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 2, "Old watch end line replaced");
  assert(result[0].text === "Some output", "Non-watch line preserved");
  assert(result[1].text.includes("Found 2 errors"), "New error count");
}

// --- Test: Form feed clears output ---
console.log("\nForm feed:");
{
  const existing = lines("Before form feed");
  const incoming = lines("\f");
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 0, "Form feed clears non-system lines");
}

// --- Test: RIS (ESC c) clears output ---
console.log("\nRIS (reset):");
{
  const existing = lines("Before reset");
  const incoming = lines("\x1bc");
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 0, "RIS clears non-system lines");
}

// --- Test: Empty lines stripped ---
console.log("\nEmpty lines after strip:");
{
  const existing = lines("Content");
  const incoming = lines("\x1b[2K"); // Clear line, no content
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 1, "Empty clear-line skipped");
}

// --- Test: Normal lines pass through ---
console.log("\nNormal lines:");
{
  const existing = lines("Existing");
  const incoming = lines("New line 1", "New line 2");
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 3, "Normal lines appended");
  assert(result[0].text === "Existing", "Existing line preserved");
  assert(result[1].text === "New line 1", "First new line");
  assert(result[2].text === "New line 2", "Second new line");
}

// --- Test: ANSI SGR color codes preserved ---
console.log("\nANSI SGR color codes:");
{
  const existing: OutputLine[] = [];
  const incoming = lines("\x1b[31mRed text\x1b[0m");
  const result = appendRunOutput(existing, incoming);

  assert(result.length === 1, "Colored line preserved");
  assert(result[0].text.includes("\x1b[31m"), "SGR color code preserved");
}

// --- Summary ---
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process?.exit?.(1);
}
