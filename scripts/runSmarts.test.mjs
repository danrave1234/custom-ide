// Run with: npm run test:ui  (node --experimental-strip-types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAppUrls, lastErrorLine, stripAnsi, urlLabel } from "../src/runSmarts.ts";

const out = (text, stream = "stdout") => ({ text, stream });

test("finds the URL a Vite-style dev server prints, through ANSI colors", () => {
  const lines = [
    out("  VITE v7.0.4  ready in 312 ms"),
    out("  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m"),
    out("  ➜  Network: use --host to expose"),
  ];
  assert.deepEqual(detectAppUrls(lines), ["http://localhost:5173/"]);
});

test("maps 0.0.0.0 to localhost, dedupes, and ignores non-local URLs", () => {
  const lines = [
    out("Docs: https://nextjs.org/docs"),
    out("Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)"),
    out("listening at http://localhost:8000/"),
    out("- Local:        http://localhost:3000"),
  ];
  assert.deepEqual(detectAppUrls(lines), ["http://localhost:3000", "http://localhost:8000/"]);
  assert.deepEqual(detectAppUrls([out("see https://example.com")]), []);
});

test("ignores Vide's own system lines", () => {
  assert.deepEqual(detectAppUrls([out("→ npm run dev   (http://localhost:9999)", "system")]), []);
});

test("urlLabel keeps host:port and meaningful paths", () => {
  assert.equal(urlLabel("http://localhost:5173/"), "localhost:5173");
  assert.equal(urlLabel("http://127.0.0.1:8000/docs"), "127.0.0.1:8000/docs");
});

test("lastErrorLine prefers error-looking lines and strips ANSI", () => {
  const lines = [
    out("compiling..."),
    out("\u001b[31mError: Cannot find module 'express'\u001b[0m", "stderr"),
    out("    at Module._resolveFilename (node:internal)", "stderr"),
    out("— process exited with code 1 —", "system"),
  ];
  assert.equal(lastErrorLine(lines), "Error: Cannot find module 'express'");
  assert.equal(lastErrorLine([out("done")]), "done");
  assert.equal(lastErrorLine([]), null);
});

test("lastErrorLine looks past package-manager wrapper lines to the real cause", () => {
  const pnpm = [
    out("Error: Cannot find module express", "stderr"),
    out("\u001b[41m ELIFECYCLE \u001b[0m Command failed with exit code 1.", "stderr"),
  ];
  assert.equal(lastErrorLine(pnpm), "Error: Cannot find module express");
  const npm = [
    out("TypeError: x is not a function", "stderr"),
    out("npm error code 1", "stderr"),
    out("npm error path C:\\app", "stderr"),
    out("npm error command failed", "stderr"),
  ];
  assert.equal(lastErrorLine(npm), "TypeError: x is not a function");
  const yarn = [out("SyntaxError: Unexpected token", "stderr"), out("error Command failed with exit code 1.", "stderr"), out("info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.")];
  assert.equal(lastErrorLine(yarn), "SyntaxError: Unexpected token");
});

test("stripAnsi removes color and OSC sequences", () => {
  assert.equal(stripAnsi("\u001b]8;;http://x\u0007link\u001b]8;;\u0007 \u001b[1mbold\u001b[0m"), "link bold");
});
