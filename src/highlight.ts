import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { escapeHtml, splitHighlightedLines } from "./codeLines";

const LANGUAGES = {
  bash, c, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin, markdown,
  php, powershell, python, ruby, rust, scss, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

const BY_EXTENSION: Record<string, string> = {
  sh: "bash", bash: "bash", zsh: "bash",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp",
  css: "css", scss: "scss", sass: "scss", less: "scss",
  go: "go",
  ini: "ini", toml: "ini", cfg: "ini", env: "ini", properties: "ini",
  java: "java", kt: "kotlin", kts: "kotlin", gradle: "kotlin",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  json: "json", jsonc: "json", lock: "json",
  md: "markdown", mdx: "markdown",
  php: "php",
  ps1: "powershell", psm1: "powershell",
  py: "python", rb: "ruby", rs: "rust", sql: "sql", swift: "swift",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml", svelte: "xml",
  yml: "yaml", yaml: "yaml",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "bash",
  ".gitignore": "bash",
  ".npmrc": "ini",
  ".editorconfig": "ini",
};

/** Above this size highlighting is skipped; the file is shown as plain text. */
const MAX_HIGHLIGHT = 400_000;

export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith(".env")) return "ini";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return BY_EXTENSION[ext] ?? null;
}

/** One HTML string per source line, syntax-highlighted when the language is known. */
export function highlightToLines(code: string, path: string): { lines: string[]; language: string | null } {
  const language = languageFor(path);
  if (!language || code.length > MAX_HIGHLIGHT) {
    return { lines: code.split("\n").map(escapeHtml), language: code.length > MAX_HIGHLIGHT ? null : language };
  }
  try {
    const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return { lines: splitHighlightedLines(html), language };
  } catch {
    return { lines: code.split("\n").map(escapeHtml), language: null };
  }
}
