export interface AnsiSpan {
  text: string;
  className: string;
}

const COLOR_CLASSES: Record<number, string> = {
  30: "ansi-black", 31: "ansi-red", 32: "ansi-green", 33: "ansi-yellow",
  34: "ansi-blue", 35: "ansi-magenta", 36: "ansi-cyan", 37: "ansi-white",
  90: "ansi-bright-black", 91: "ansi-bright-red", 92: "ansi-bright-green",
  93: "ansi-bright-yellow", 94: "ansi-bright-blue", 95: "ansi-bright-magenta",
  96: "ansi-bright-cyan", 97: "ansi-bright-white",
};

// eslint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([0-9;]*)m/g;

/** Convert a line with ANSI SGR codes into styled spans; strips everything else. */
export function parseAnsiLine(input: string): AnsiSpan[] {
  // carriage-return rewrites (progress bars): keep only the final frame
  const cr = input.lastIndexOf("\r");
  let line = cr >= 0 ? input.slice(cr + 1) : input;
  line = line.replace(OSC, "");
  // strip non-SGR CSI sequences (cursor movement etc.)
  // eslint-disable-next-line no-control-regex
  line = line.replace(/\x1b\[[0-9;?]*[A-LN-Za-ln-z]/g, "");

  const spans: AnsiSpan[] = [];
  let color = "";
  let bold = false;
  let last = 0;
  let match: RegExpExecArray | null;
  SGR.lastIndex = 0;
  while ((match = SGR.exec(line)) !== null) {
    if (match.index > last) {
      spans.push({ text: line.slice(last, match.index), className: cls(color, bold) });
    }
    const codes = match[1] === "" ? [0] : match[1].split(";").map((n) => parseInt(n, 10));
    for (const code of codes) {
      if (code === 0) { color = ""; bold = false; }
      else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = "";
      else if (COLOR_CLASSES[code]) color = COLOR_CLASSES[code];
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    spans.push({ text: line.slice(last), className: cls(color, bold) });
  }
  return spans.length ? spans : [{ text: "", className: "" }];
}

const cls = (color: string, bold: boolean) =>
  [color, bold ? "ansi-bold" : ""].filter(Boolean).join(" ");
