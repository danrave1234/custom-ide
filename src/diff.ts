export type DiffLineKind = "add" | "del" | "ctx" | "hunk";

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  isBinary: boolean;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");

/** Parse `git diff` / `git show` unified patch output (possibly multi-file). */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/);
      current = {
        oldPath: m ? m[1] : raw.slice(11),
        newPath: m ? m[2] : raw.slice(11),
        isNew: false,
        isDeleted: false,
        isRename: false,
        isBinary: false,
        lines: [],
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (raw.startsWith("new file")) { current.isNew = true; continue; }
    if (raw.startsWith("deleted file")) { current.isDeleted = true; continue; }
    if (raw.startsWith("rename from") || raw.startsWith("rename to")) { current.isRename = true; continue; }
    if (raw.startsWith("Binary file")) { current.isBinary = true; continue; }
    if (raw.startsWith("index ") || raw.startsWith("similarity ") ||
        raw.startsWith("old mode") || raw.startsWith("new mode") ||
        raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      continue;
    }

    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      oldNo = parseInt(hunk[1], 10);
      newNo = parseInt(hunk[2], 10);
      current.lines.push({ kind: "hunk", oldNo: null, newNo: null, text: raw });
      continue;
    }

    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: raw.slice(1) });
      current.additions++;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: raw.slice(1) });
      current.deletions++;
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
    } else if (raw === "\\ No newline at end of file") {
      continue;
    }
  }

  return files.map((f) => ({ ...f, oldPath: stripPrefix(f.oldPath), newPath: stripPrefix(f.newPath) }));
}
