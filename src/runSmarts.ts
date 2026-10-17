// Small heuristics over run output. Kept dependency-free so they can be
// unit-tested with plain Node (scripts/runSmarts.test.mjs).

interface Line {
  text: string;
  stream: "stdout" | "stderr" | "system";
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

// dev servers print where they listen: "Local: http://localhost:5173/", "http://127.0.0.1:8000"
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'")\]>,;]*)?/gi;

/** Distinct local URLs a running server printed, newest first (at most `max`). */
export function detectAppUrls(lines: Line[], max = 2): string[] {
  const seen: string[] = [];
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 400) && seen.length < max; i--) {
    if (lines[i].stream === "system") continue;
    for (const m of stripAnsi(lines[i].text).matchAll(LOCAL_URL)) {
      // 0.0.0.0 / [::] mean "all interfaces": open them as localhost
      const url = m[0].replace(/\/\/(?:0\.0\.0\.0|\[::\])/, "//localhost").replace(/[.]+$/, "");
      const key = url.replace(/\/$/, "");
      if (!seen.some((u) => u.replace(/\/$/, "") === key)) seen.push(url);
      if (seen.length >= max) break;
    }
  }
  return seen;
}

/** Short label for a URL button: "localhost:5173" (path kept when it adds information). */
export function urlLabel(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)(\/.*)?$/i);
  if (!m) return url;
  const path = m[2] && m[2] !== "/" ? m[2] : "";
  return (m[1] + path).slice(0, 40);
}

const ERRORISH = /\b(error|exception|failed|fatal|cannot|not found|denied|refused|panic)\b/i;

// what npm / pnpm / yarn print after a script fails; it hides the real cause
const PM_BOILERPLATE =
  /ELIFECYCLE|^npm (ERR!|error)|^error Command failed with exit code|^info Visit https:\/\/yarnpkg|Command failed with exit code \d+|^\s*at\s/i;

/** The most useful single line to show when a run dies: the last error-looking line, else the last output. */
export function lastErrorLine(lines: Line[]): string | null {
  let fallback: string | null = null;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 80); i--) {
    if (lines[i].stream === "system") continue;
    const text = stripAnsi(lines[i].text).trim();
    if (!text || PM_BOILERPLATE.test(text)) continue;
    if (ERRORISH.test(text)) return text.length > 180 ? text.slice(0, 177) + "…" : text;
    fallback ??= text;
  }
  return fallback && (fallback.length > 180 ? fallback.slice(0, 177) + "…" : fallback);
}
