import type { RepoInfo, RunSession } from "../types";
import OutputPane from "./OutputPane";
import CopyButton from "./CopyButton";
import FreePortButton from "./FreePortButton";
import { useResizableY } from "../useResizable";

interface Props {
  sessions: RunSession[];
  repos: RepoInfo[];
  activeSessionId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectSession: (id: string) => void;
  onRestart: (session: RunSession) => void;
  onStop: (id: string) => void;
  onClear: (id: string) => void;
  onError: (msg: string) => void;
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export default function OutputDrawer({
  sessions,
  repos,
  activeSessionId,
  open,
  onToggle,
  onSelectSession,
  onRestart,
  onStop,
  onClear,
  onError,
}: Props) {
  const [height, onResize] = useResizableY("vd-drawer-h", 280, 140, 650);

  if (sessions.length === 0) return null;

  const repoLabel = (path: string) => repos.find((r) => r.path === path)?.name ?? basename(path);
  const running = sessions.filter((s) => s.status === "running");
  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  return (
    <div className="output-drawer">
      {open && <div className="resizer-h" onMouseDown={onResize} />}
      <button className="drawer-strip" onClick={onToggle}>
        <span className="drawer-caret">{open ? "▾" : "▴"}</span>
        <span className="drawer-title">Terminal</span>
        {running.length > 0 ? (
          <span className="drawer-summary running">
            <span className="running-dot" /> {running.length} running
          </span>
        ) : (
          <span className="drawer-summary">{sessions.length} finished</span>
        )}
        {!open &&
          running.slice(0, 4).map((s) => (
            <span key={s.id} className="drawer-chip">
              {repoLabel(s.repoPath)} / {s.name}
            </span>
          ))}
      </button>
      {open && active && (
        <div className="drawer-body" style={{ height }}>
          <div className="session-tabs">
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`session-tab ${active.id === s.id ? "active" : ""} status-${s.status}`}
                onClick={() => onSelectSession(s.id)}
              >
                <span className={`status-dot status-${s.status}`} />
                {repoLabel(s.repoPath)} / {s.name}
                {s.status === "exited" && s.exitCode !== null && s.exitCode !== 0 && ` (${s.exitCode})`}
              </button>
            ))}
          </div>
          <div className="session-toolbar">
            <span className="session-command">{active.command}</span>
            <span className="session-actions">
              <FreePortButton session={active} onRestart={onRestart} onError={onError} />
              <button className="mini-btn run" title="Kill and run again" onClick={() => onRestart(active)}>
                ⟳ Restart
              </button>
              {active.status === "running" && (
                <button className="mini-btn danger" onClick={() => onStop(active.id)}>
                  ■ Stop
                </button>
              )}
              <CopyButton getText={() => active.lines.map((l) => l.text).join("\n")} />
              <button className="mini-btn" onClick={() => onClear(active.id)}>
                Clear
              </button>
            </span>
          </div>
          <OutputPane session={active} />
        </div>
      )}
    </div>
  );
}
