import { useEffect, useRef, useState } from "react";
import TerminalPane from "./TerminalPane";
import { useResizableY } from "../useResizable";

interface Term {
  id: string;
  title: string;
  cwd: string;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  /** cwd for newly opened terminals — the selected repo or workspace root */
  defaultCwd: string;
  defaultLabel: string;
}

export default function TerminalDrawer({ open, onToggle, defaultCwd, defaultLabel }: Props) {
  const [height, onResize] = useResizableY("vd-terminal-h", 300, 140, 700);
  const [terms, setTerms] = useState<Term[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const counter = useRef(0);

  const newTerm = () => {
    counter.current += 1;
    const id = `term-${Date.now()}-${counter.current}`;
    const title = `${defaultLabel} ${counter.current}`;
    setTerms((prev) => [...prev, { id, title, cwd: defaultCwd }]);
    setActiveId(id);
  };

  const closeTerm = (id: string) => {
    setTerms((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? next[next.length - 1]?.id ?? null : cur));
      return next;
    });
  };

  // open a first terminal automatically the first time the drawer is shown
  useEffect(() => {
    if (open && terms.length === 0) newTerm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="terminal-drawer">
      {open && <div className="resizer-h" onMouseDown={onResize} />}
      <div className="terminal-tabbar">
        <button className="drawer-caret-btn" onClick={onToggle} title={open ? "Hide terminal" : "Show terminal"}>
          {open ? "▾" : "▴"} Terminal
        </button>
        {open && (
          <>
            <div className="terminal-tabs">
              {terms.map((t) => (
                <span
                  key={t.id}
                  className={`terminal-tab ${activeId === t.id ? "active" : ""}`}
                  onClick={() => setActiveId(t.id)}
                >
                  {t.title}
                  <button
                    className="term-close"
                    title="Close terminal"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTerm(t.id);
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <button className="mini-btn term-new" onClick={newTerm} title="New terminal">
              + New
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="terminal-body" style={{ height }}>
          {terms.length === 0 ? (
            <div className="config-hint" style={{ padding: 16 }}>
              No terminals — click “+ New”.
            </div>
          ) : (
            terms.map((t) => (
              <TerminalPane key={t.id} id={t.id} cwd={t.cwd} visible={t.id === activeId} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
