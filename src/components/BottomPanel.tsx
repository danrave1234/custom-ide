import { useEffect, useRef, useState } from "react";
import type { RepoInfo, RunSession } from "../types";
import type { AgentCli } from "../api";
import TerminalPane from "./TerminalPane";
import { useResizableY } from "../useResizable";
import { ChevronDown, ChevronRight, Close } from "./Icons";

interface Term {
  id: string;
  title: string;
  cwd: string;
  command?: string;
}

/** A request from App (agent API, command palette) to open a terminal. */
export interface TerminalRequest {
  nonce: number;
  cwd: string;
  title?: string;
  command?: string;
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
  /** coding-agent CLIs found on PATH, offered in the "+ Agent" menu */
  agentClis: AgentCli[];
  terminalRequest: TerminalRequest | null;
}

/**
 * Bottom panel: terminals only. Run output stays in the Favorites / Run / Sync
 * views; this panel just shows how many runs are going.
 */
export default function BottomPanel({
  sessions,
  open,
  onToggle,
  defaultCwd,
  defaultLabel,
  agentClis,
  terminalRequest,
}: Props) {
  const [height, onResize] = useResizableY("vd-bottom-h", 300, 140, 650);
  const [terms, setTerms] = useState<Term[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const counter = useRef(0);

  const addTerm = (cwd: string, title?: string, command?: string) => {
    counter.current += 1;
    const id = `term-${Date.now()}-${counter.current}`;
    setTerms((prev) => [...prev, { id, title: title ?? `${defaultLabel} ${counter.current}`, cwd, command }]);
    setActiveTermId(id);
  };

  const newTerm = () => addTerm(defaultCwd);

  const launchAgent = (agent: AgentCli) => {
    setAgentMenuOpen(false);
    addTerm(defaultCwd, `${agent.name} · ${defaultLabel}`, agent.command);
  };

  useEffect(() => {
    if (terminalRequest) addTerm(terminalRequest.cwd, terminalRequest.title, terminalRequest.command);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalRequest?.nonce]);

  const closeTerm = (id: string) => {
    setTerms((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTermId((cur) => (cur === id ? next[next.length - 1]?.id ?? null : cur));
      return next;
    });
  };

  // Open the first terminal when the panel is shown
  useEffect(() => {
    if (open && terms.length === 0 && !terminalRequest) newTerm();
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
          {open && agentClis.length > 0 && (
            <div className="agent-launch">
              <button
                className="mini-btn"
                onClick={() => setAgentMenuOpen((v) => !v)}
                title={`Launch a coding agent in ${defaultLabel}`}
                aria-haspopup="menu"
                aria-expanded={agentMenuOpen}
              >
                + Agent <ChevronDown size={10} />
              </button>
              {agentMenuOpen && (
                <>
                  <div className="ws-backdrop" onClick={() => setAgentMenuOpen(false)} />
                  <div className="agent-menu" role="menu">
                    <div className="ws-section">Launch in {defaultLabel}</div>
                    {agentClis.map((a) => (
                      <button key={a.id} role="menuitem" className="agent-menu-item" onClick={() => launchAgent(a)} title={a.path}>
                        <span>{a.name}</span>
                        <code>{a.command}</code>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
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
                <div className="bottom-empty-icon">{">_"}</div>
                <div className="bottom-empty-text">No terminals</div>
                <div className="bottom-empty-hint">
                  Click "+ New" to open a terminal{agentClis.length > 0 ? ', or "+ Agent" to launch a coding agent' : ""}
                </div>
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
                  <TerminalPane key={t.id} id={t.id} cwd={t.cwd} command={t.command} visible={t.id === activeTermId} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
