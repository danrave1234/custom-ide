import { memo, useEffect, useRef } from "react";
import { parseAnsiLine } from "../ansi";
import type { OutputLine, RunSession } from "../types";

interface Props {
  session: RunSession;
}

// line objects are stable across appends, so memo means only NEW lines pay
// for ANSI parsing and re-rendering — not all 2000 on every batch
const Row = memo(function Row({ line }: { line: OutputLine }) {
  if (line.stream === "system") {
    return <div className="out-line out-system">{line.text}</div>;
  }
  const spans = parseAnsiLine(line.text);
  return (
    <div className={`out-line ${line.stream === "stderr" ? "out-stderr" : ""}`}>
      {spans.map((s, j) => (
        <span key={j} className={s.className}>
          {s.text}
        </span>
      ))}
    </div>
  );
});

export default function OutputPane({ session }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [session.lines.length]);

  return (
    <div className="output-pane" ref={scrollRef} onScroll={onScroll}>
      {session.lines.map((line, i) => (
        <Row key={i} line={line} />
      ))}
      {session.lines.length === 0 && <div className="out-line out-system">Waiting for output…</div>}
    </div>
  );
}
