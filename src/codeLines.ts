// Helpers for the code viewer that don't depend on the highlighter, so they
// can be unit-tested with plain Node (scripts/codeLines.test.mjs).

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Split highlighter HTML (text plus `<span class="…">…</span>`) into one HTML
 * string per source line. Spans that cross a newline are closed at the end of
 * the line and reopened on the next, so every line is balanced on its own.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  const tag = /<span[^>]*>|<\/span>|\n/g;
  let last = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    current += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "\n") {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
    } else if (m[0] === "</span>") {
      open.pop();
      current += m[0];
    } else {
      open.push(m[0]);
      current += m[0];
    }
  }
  lines.push(current + html.slice(last));
  return lines;
}

export type LineMark = "add" | "del";

/**
 * Gutter marks for the working-tree version of a file from its unified diff:
 * added lines get "add", and the line right after a deletion gets "del".
 */
export function changeMarks(patch: string): Map<number, LineMark> {
  const marks = new Map<number, LineMark>();
  let newNo = 0;
  let pendingDel = false;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newNo = Number(hunk[1]);
      pendingDel = false;
      continue;
    }
    if (newNo === 0 || line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      marks.set(newNo, "add");
      newNo++;
      pendingDel = false;
    } else if (line.startsWith("-")) {
      pendingDel = true;
    } else if (line.startsWith(" ")) {
      if (pendingDel && !marks.has(newNo)) marks.set(newNo, "del");
      pendingDel = false;
      newNo++;
    }
  }
  if (pendingDel && !marks.has(newNo)) marks.set(Math.max(1, newNo), "del");
  return marks;
}

/** Fuzzy subsequence score for quick open; higher is better, -1 is no match. */
export function fuzzyScore(path: string, query: string): number {
  const p = path.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (base.startsWith(q)) return 1000 - base.length;
  if (base.includes(q)) return 800 - base.length;
  if (p.includes(q)) return 600 - p.length;
  let score = 0;
  let pi = 0;
  let streak = 0;
  for (const ch of q) {
    const found = p.indexOf(ch, pi);
    if (found === -1) return -1;
    streak = found === pi ? streak + 1 : 0;
    score += 1 + streak * 2;
    pi = found + 1;
  }
  return score - p.length / 10;
}
