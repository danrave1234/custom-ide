import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import type { CustomConfig, DetectedConfig, RunSession } from "../types";
import OutputPane from "./OutputPane";
import CopyButton from "./CopyButton";
import FreePortButton from "./FreePortButton";
import { useResizable } from "../useResizable";

interface Props {
  repoPath: string;
  sessions: RunSession[];
  activeSessionId: string | null;
  customConfigs: CustomConfig[];
  pinnedConfigs: CustomConfig[];
  onStart: (name: string, command: string, cwd: string) => void;
  onRestart: (session: RunSession) => void;
  onStop: (id: string) => void;
  onClear: (id: string) => void;
  onSelectSession: (id: string) => void;
  onAddCustom: (config: CustomConfig) => void;
  onRemoveCustom: (name: string) => void;
  onTogglePin: (config: CustomConfig) => void;
  onError: (msg: string) => void;
}

export default function RunView({
  repoPath,
  sessions,
  activeSessionId,
  customConfigs,
  pinnedConfigs,
  onStart,
  onRestart,
  onStop,
  onClear,
  onSelectSession,
  onAddCustom,
  onRemoveCustom,
  onTogglePin,
  onError,
}: Props) {
  const [detected, setDetected] = useState<DetectedConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [panelWidth, onPanelResize] = useResizable("vd-run-w", 340, 240, 700);

  useEffect(() => {
    setLoading(true);
    setQuery("");
    setSourceFilter(null);
    api
      .detectRunConfigs(repoPath)
      .then(setDetected)
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }, [repoPath, onError]);

  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
  const runningIds = new Set(sessions.filter((s) => s.status === "running").map((s) => s.id));
  const pinnedNames = new Set(pinnedConfigs.map((p) => p.name));
  const sessionIdFor = (name: string) => `${repoPath}::${name}`;

  const q = query.trim().toLowerCase();
  const matches = (name: string, command: string) =>
    !q || name.toLowerCase().includes(q) || command.toLowerCase().includes(q);

  const sources = useMemo(
    () => [...new Set(detected.map((c) => c.source))],
    [detected]
  );

  const filteredPinned = pinnedConfigs.filter((c) => matches(c.name, c.command));
  const filteredCustom = customConfigs.filter((c) => matches(c.name, c.command));
  const filteredDetected = detected.filter(
    (c) => matches(c.name, c.command) && (!sourceFilter || c.source === sourceFilter)
  );
  const grouped = filteredDetected.reduce<Record<string, DetectedConfig[]>>((acc, c) => {
    (acc[c.source] ??= []).push(c);
    return acc;
  }, {});

  const configRow = (
    name: string,
    command: string,
    cwd: string,
    opts: { removable?: boolean; pinnable?: boolean } = {}
  ) => {
    const id = sessionIdFor(name);
    const isRunning = runningIds.has(id);
    const isPinned = pinnedNames.has(name);
    return (
      <li className="config-row" key={name}>
        <button
          className={`icon-btn pin-btn ${isPinned ? "pinned" : ""}`}
          title={isPinned ? "Unpin" : "Pin to top"}
          onClick={() => onTogglePin({ name, command, cwd })}
        >
          {isPinned ? "★" : "☆"}
        </button>
        <div className="config-info" title={`${command}  (${cwd})`}>
          <span className="config-name">{name}</span>
          <span className="config-command">{command}</span>
        </div>
        <div className="config-actions">
          {isRunning ? (
            <button className="mini-btn danger" onClick={() => onStop(id)}>
              ■ Stop
            </button>
          ) : (
            <button className="mini-btn run" onClick={() => onStart(name, command, cwd)}>
              ▶ Run
            </button>
          )}
          {opts.removable && (
            <button className="icon-btn danger" title="Remove config" onClick={() => onRemoveCustom(name)}>
              ✕
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="run-view">
      <div className="run-configs" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="run-search">
          <input
            placeholder="Search configs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {sources.length > 1 && (
            <div className="filter-chips">
              <button
                className={`chip ${sourceFilter === null ? "active" : ""}`}
                onClick={() => setSourceFilter(null)}
              >
                all
              </button>
              {sources.map((s) => (
                <button
                  key={s}
                  className={`chip ${sourceFilter === s ? "active" : ""}`}
                  onClick={() => setSourceFilter(sourceFilter === s ? null : s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredPinned.length > 0 && (
          <>
            <div className="section-header">
              <span>★ Pinned</span>
            </div>
            <ul className="config-list">
              {filteredPinned.map((c) => configRow(c.name, c.command, c.cwd))}
            </ul>
          </>
        )}

        <div className="section-header">
          <span>Saved configs</span>
          <button className="mini-btn" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? "Cancel" : "+ Add"}
          </button>
        </div>
        {showAdd && (
          <form
            className="add-config-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim() || !newCommand.trim()) return;
              onAddCustom({ name: newName.trim(), command: newCommand.trim(), cwd: repoPath });
              setNewName("");
              setNewCommand("");
              setShowAdd(false);
            }}
          >
            <input placeholder="Name (e.g. start dev)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input
              placeholder="Command (e.g. npm run dev)"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
            />
            <button className="mini-btn" type="submit">
              Save
            </button>
          </form>
        )}
        <ul className="config-list">
          {filteredCustom.map((c) => configRow(c.name, c.command, c.cwd, { removable: true }))}
          {customConfigs.length === 0 && !showAdd && (
            <li className="config-hint">Save your own commands here — they persist per repo.</li>
          )}
        </ul>

        <div className="section-header">
          <span>Detected {loading ? "…" : ""}</span>
        </div>
        {Object.entries(grouped).map(([source, configs]) => (
          <div key={source}>
            <div className="config-group-label">{source}</div>
            <ul className="config-list">
              {configs.map((c) => configRow(c.name, c.command, c.cwd))}
            </ul>
          </div>
        ))}
        {!loading && detected.length === 0 && (
          <div className="config-hint">No runnable configs detected in this repo.</div>
        )}
        {!loading && detected.length > 0 && filteredDetected.length === 0 && (
          <div className="config-hint">Nothing matches “{query}”.</div>
        )}
      </div>
      <div className="resizer" onMouseDown={onPanelResize} />

      <div className="run-output">
        <div className="session-tabs">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session-tab ${active?.id === s.id ? "active" : ""} status-${s.status}`}
              onClick={() => onSelectSession(s.id)}
            >
              <span className={`status-dot status-${s.status}`} />
              {s.name}
              {s.status === "exited" && s.exitCode !== null && s.exitCode !== 0 && ` (${s.exitCode})`}
            </button>
          ))}
          {sessions.length === 0 && <span className="config-hint">Run something to see its output here.</span>}
        </div>
        {active && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
