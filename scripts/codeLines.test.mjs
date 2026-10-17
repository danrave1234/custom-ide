// Run with: npm run test:ui  (node --experimental-strip-types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitHighlightedLines, changeMarks, fuzzyScore, escapeHtml } from "../src/codeLines.ts";

test("spans crossing newlines are closed and reopened per line", () => {
  const html = 'a<span class="c">/* one\ntwo */</span>b\nc';
  assert.deepEqual(splitHighlightedLines(html), [
    'a<span class="c">/* one</span>',
    '<span class="c">two */</span>b',
    "c",
  ]);
});

test("nested spans survive a split", () => {
  const html = '<span class="a"><span class="b">x\ny</span>z</span>';
  assert.deepEqual(splitHighlightedLines(html), [
    '<span class="a"><span class="b">x</span></span>',
    '<span class="a"><span class="b">y</span>z</span>',
  ]);
});

test("line count matches source line count", () => {
  assert.equal(splitHighlightedLines("one\ntwo\n").length, 3);
  assert.equal(splitHighlightedLines("").length, 1);
});

test("change marks map additions and deletions onto new line numbers", () => {
  const patch = [
    "diff --git a/f b/f",
    "--- a/f",
    "+++ b/f",
    "@@ -1,4 +1,4 @@",
    " keep",
    "-old",
    "+new",
    " keep2",
    "-gone",
    " keep3",
  ].join("\n");
  const marks = changeMarks(patch);
  assert.equal(marks.get(2), "add");
  assert.equal(marks.get(4), "del");
  assert.equal(marks.has(1), false);
});

test("fuzzy score prefers file-name prefix matches", () => {
  const a = fuzzyScore("src/components/CodeView.tsx", "codev");
  const b = fuzzyScore("src/components/ChangesView.tsx", "codev");
  assert.ok(a > b);
  assert.equal(fuzzyScore("src/App.tsx", "zzz"), -1);
});

test("escapeHtml escapes markup", () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("containingRoot matches across separators, case and subfolders", async () => {
  const { containingRoot } = await import("../src/codeLines.ts");
  const roots = ["C:/work/app", "C:\\work\\app\\packages\\api", "C:/work/other"];
  assert.equal(containingRoot(roots, "c:\\Work\\App"), "C:/work/app");
  assert.equal(containingRoot(roots, "C:\\work\\app\\src\\x.ts"), "C:/work/app");
  assert.equal(containingRoot(roots, "C:/work/app/packages/api/src"), "C:\\work\\app\\packages\\api");
  assert.equal(containingRoot(roots, "C:/work/application"), null);
});
