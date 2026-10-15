import { useEffect, useRef, useState } from "react";
import type { RepoInfo, RunSession } from "../types";
import TerminalPane from "./TerminalPane";
import { useResizableY } from "../useResizable";
import { ChevronDown, ChevronRight, Close } from "./Icons";

interface Term {
  id: string;
  title: string;
  cwd: string;
}

interface Props {
  sessions: RunSession[];
  repos: RepoInfo[];
  activeSessionId: string | null;
  /** Controlled by App (top-bar "Terminal" button, command palette, caret). */
  open: boolean;
  onToggle: () => void;
  onSelectSession: (id: string) => void;
  onRestart: (session: RunSession) => void;
  onStop: (id: string) => void;
  onClear: (id: string) => void;
  onError: (msg: string) => void;
  /** cwd for newly opened terminals */
  defaultCwd: string;
  defaultLabel: string;
}

/**
 * Bottom panel: terminals only. Run output stays in the Favorites / Run / Sync
 * views; this panel just shows how many runs are going.
 */
export default function BottomPanel({ sessions, open, onToggle, defaultCwd, defaultLabel }: Props) {
  const [height, onResize] = useResizableY("vd-bottom-h", 300, 140, 650);
  const [terms, setTerms] = useState<Term[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const counter = useRef(0);

  const newTerm = () => {
    counter.current += 1;
    const id = `term-${Date.now()}-${counter.current}`;
    const title = `${defaultLabel} ${counter.current}`;
    setTerms((prev) => [...prev, { id, title, cwd: defaultCwd }]);
    setActiveTermId(id);
  };

  const closeTerm = (id: string) => {
    setTerms((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTermId((cur) => (cur === id ? next[next.length - 1]?.id ?? null : cur));
      return next;
    });
  };

  // Open the first terminal when the panel is shown
  useEffect(() => {
    if (open && terms.length === 0) newTerm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const running = sessions.filter((s) => s.status === "running");
  const totalRunning = running.length;

  return (
    <div className="bottom-panel">
      {open && <div className="resizer-h" onMouseDown={onResize} />}
      <div className="bottom-strip">
        <button className="drawer-caret-btn" onClick={onToggle} title={open ? "Hide panel" : "Show panel"}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <div className="bottom-mode-pills">
          <button className="mode-pill active" onClick={onToggle}>
            Terminal
            {terms.length > 0 && <span className="pill-count">{terms.length}</span>}
          </button>
        </div>
        {totalRunning > 0 && (
          <span className="running-indicator" title={`${totalRunning} process(es) running`}>
            <span className="running-dot" /> {totalRunning} running
          </span>
        )}
        {!open && running.slice(0, 3).map((s) => (
          <span key={s.id} className="drawer-chip">
            {s.name}
          </span>
        ))}
        <div className="bottom-strip-actions">
          {open && (
            <button className="mini-btn term-new" onClick={newTerm} title="New terminal">
              + New
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="bottom-body" style={{ height }}>
          <div className="terminal-body">
            {terms.length === 0 ? (
              <div className="bottom-empty">
                <div className="bottom-empty-icon">{"&gt;_"}</div>
                <div className="bottom-empty-text">No terminals</div>
                <div className="bottom-empty-hint">Click "+ New" to open a terminal</div>
              </div>
            ) : (
              <>
                <div className="terminal-tabs">
                  {terms.map((t) => (
                    <span
                      key={t.id}
                      className={`terminal-tab ${activeTermId === t.id ? "active" : ""}`}
                      onClick={() => setActiveTermId(t.id)}
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
                        <Close size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                {terms.map((t) => (
                  <TerminalPane key={t.id} id={t.id} cwd={t.cwd} visible={t.id === activeTermId} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
