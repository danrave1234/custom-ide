import type { RepoInfo, RunSession } from "../types";
import OutputPane from "./OutputPane";
import CopyButton from "./CopyButton";
import FreePortButton from "./FreePortButton";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo } from "react";
import { detectAppUrls, urlLabel } from "../runSmarts";
import { Refresh, Stop as StopIcon } from "./Icons";

interface Props {
  sessions: RunSession[];
  activeSessionId: string | null;
  repos?: RepoInfo[];
  onSelectSession: (id: string) => void;
  onRestart?: (session: RunSession) => void;
  onStop: (id: string) => void;
  onClear: (id: string) => void;
  onError: (msg: string) => void;
  /** Override the label shown in session tabs; defaults to session.name */
  repoLabel?: (path: string) => string;
  /** Show restart button (default true) */
  showRestart?: boolean;
  /** Show free-port button (default true) */
  showFreePort?: boolean;
  /** Custom empty state hint text */
  emptyHint?: string;
}

const defaultRepoLabel = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export default function SessionOutput({
  sessions,
  activeSessionId,
  repos,
  onSelectSession,
  onRestart,
  onStop,
  onClear,
  onError,
  repoLabel,
  showRestart = true,
  showFreePort = true,
  emptyHint,
}: Props) {
  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
  // where a running dev server says it is listening, so it can be opened in one click
  const urls = useMemo(
    () => (active?.status === "running" ? detectAppUrls(active.lines) : []),
    [active?.status, active?.lines]
  );
  const labelFn = repoLabel ?? ((path: string) => {
    const r = repos?.find((rp) => rp.path === path);
    return r?.name ?? defaultRepoLabel(path);
  });

  return (
    <div className="run-output">
      <div className="session-tabs">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-tab ${active?.id === s.id ? "active" : ""} status-${s.status}`}
            onClick={() => onSelectSession(s.id)}
          >
            <span className={`status-dot status-${s.status}`} />
            {repos ? `${labelFn(s.repoPath)} / ${s.name}` : s.name}
            {s.status === "exited" && s.exitCode !== null && s.exitCode !== 0 && ` (${s.exitCode})`}
          </button>
        ))}
        {sessions.length === 0 && (
          <span className="config-hint">
            {emptyHint ?? "Run something to see its output here."}
          </span>
        )}
      </div>
      {active && (
        <>
          <div className="session-toolbar">
            <span className="session-command">{active.command}</span>
            <span className="session-actions">
              {urls.map((url) => (
                <button
                  key={url}
                  className="mini-btn open-url"
                  title={`Open ${url} in your browser`}
                  onClick={() => openUrl(url).catch((e) => onError(String(e)))}
                >
                  Open {urlLabel(url)} ↗
                </button>
              ))}
              {showFreePort && onRestart && (
                <FreePortButton session={active} onRestart={onRestart} onError={onError} />
              )}
              {showRestart && onRestart && (
                <button
                  className="mini-btn run"
                  title="Kill and run again"
                  onClick={() => onRestart(active)}
                >
                  <Refresh size={10} /> Restart
                </button>
              )}
              {active.status === "running" && (
                <button className="mini-btn danger" onClick={() => onStop(active.id)}>
                  <StopIcon size={10} /> Stop
                </button>
              )}
              <CopyButton getText={() => active.lines.map((l) => l.text).join("\n")} />
              <button className="mini-btn" onClick={() => onClear(active.id)}>
                Clear
              </button>
            </span>
          </div>
          <OutputPane session={active} />
        </>
      )}
    </div>
  );
}
