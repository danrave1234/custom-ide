import { useState } from "react";
import { confirmAsk } from "../api";
import type { CustomConfig, GroupItem, RepoInfo, RunGroup, RunSession } from "../types";
import OutputPane from "./OutputPane";
import CopyButton from "./CopyButton";
import FreePortButton from "./FreePortButton";
import { useResizable } from "../useResizable";

const GROUP_ICONS = ["📁", "🚀", "🔥", "⚙️", "🧩", "🖥️", "🌐", "📦", "🗄️", "🎨", "📱", "🤖", "⚡", "🛠️"];

interface Props {
  repos: RepoInfo[];
  pinnedByRepo: Record<string, CustomConfig[]>;
  groups: RunGroup[];
  sessions: RunSession[];
  activeSessionId: string | null;
  onStart: (repoPath: string, name: string, command: string, cwd: string) => void;
  onRestart: (session: RunSession) => void;
  onStop: (id: string) => void;
  onClear: (id: string) => void;
  onSelectSession: (id: string) => void;
  onTogglePin: (repoPath: string, config: CustomConfig) => void;
  onError: (msg: string) => void;
  onAddGroup: (name: string) => void;
  onRemoveGroup: (name: string) => void;
  onAddToGroup: (groupName: string, item: GroupItem) => void;
  onRemoveFromGroup: (groupName: string, itemKey: string) => void;
  onMoveInGroup: (groupName: string, itemKey: string, delta: -1 | 1) => void;
  onSetGroupDelay: (groupName: string, delaySeconds: number) => void;
  onSetGroupIcon: (groupName: string, icon: string) => void;
  onReorderGroups: (srcName: string, destName: string) => void;
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function FavoritesView({
  repos,
  pinnedByRepo,
  groups,
  sessions,
  activeSessionId,
  onStart,
  onRestart,
  onStop,
  onClear,
  onSelectSession,
  onTogglePin,
  onError,
  onAddGroup,
  onRemoveGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onMoveInGroup,
  onSetGroupDelay,
  onSetGroupIcon,
  onReorderGroups,
}: Props) {
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [startingGroup, setStartingGroup] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [panelWidth, onPanelResize] = useResizable("vd-favorites-w", 430, 260, 800);
  // groups are collapsed unless explicitly expanded
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("vd-expanded-groups") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [showAllFavorites, setShowAllFavorites] = useState(
    () => localStorage.getItem("vd-show-all-favs") === "1"
  );

  const setExpandedPersist = (updater: (prev: Set<string>) => Set<string>) => {
    setExpanded((prev) => {
      const next = updater(prev);
      localStorage.setItem("vd-expanded-groups", JSON.stringify([...next]));
      return next;
    });
  };

  const toggleCollapsed = (name: string) => {
    setExpandedPersist((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllFavorites = () => {
    setShowAllFavorites((show) => {
      localStorage.setItem("vd-show-all-favs", show ? "0" : "1");
      return !show;
    });
  };

  const repoLabel = (path: string) => repos.find((r) => r.path === path)?.name ?? basename(path);
  const idFor = (repoPath: string, name: string) => `${repoPath}::${name}`;
  const runningIds = new Set(sessions.filter((s) => s.status === "running").map((s) => s.id));

  const entries = Object.entries(pinnedByRepo)
    .map(([repoPath, configs]) => ({ repoPath, configs }))
    .filter((e) => e.configs.length > 0)
    .sort((a, b) => repoLabel(a.repoPath).localeCompare(repoLabel(b.repoPath)));

  const total = entries.reduce((n, e) => n + e.configs.length, 0);

  const allFavorites: GroupItem[] = entries.flatMap((e) =>
    e.configs.map((c) => ({ ...c, repoPath: e.repoPath }))
  );
  const idleFavorites = allFavorites.filter((f) => !runningIds.has(idFor(f.repoPath, f.name)));

  const runItems = (items: GroupItem[]) => {
    for (const item of items) {
      if (!runningIds.has(idFor(item.repoPath, item.name))) {
        onStart(item.repoPath, item.name, item.command, item.cwd);
      }
    }
  };

  // start group members one by one in list order, pausing between each
  const runGroupSequential = async (groupName: string, items: GroupItem[], delaySeconds: number) => {
    const toStart = items.filter((i) => !runningIds.has(idFor(i.repoPath, i.name)));
    if (toStart.length === 0) return;
    setStartingGroup(groupName);
    try {
      for (let i = 0; i < toStart.length; i++) {
        const item = toStart[i];
        onStart(item.repoPath, item.name, item.command, item.cwd);
        if (i < toStart.length - 1 && delaySeconds > 0) {
          await sleep(delaySeconds * 1000);
        }
      }
    } finally {
      setStartingGroup(null);
    }
  };

  const stopItems = (items: GroupItem[]) => {
    for (const item of items) {
      const id = idFor(item.repoPath, item.name);
      if (runningIds.has(id)) onStop(id);
    }
  };

  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  const itemRow = (
    item: GroupItem,
    opts: { group?: string; pinStar?: boolean; index?: number; count?: number }
  ) => {
    const id = idFor(item.repoPath, item.name);
    const isRunning = runningIds.has(id);
    return (
      <li className="config-row" key={`${opts.group ?? "fav"}-${id}`}>
        {opts.group && (
          <span className="order-controls">
            <span className="order-no">{(opts.index ?? 0) + 1}</span>
            <button
              className="icon-btn order-btn"
              title="Start earlier"
              disabled={opts.index === 0}
              onClick={() => onMoveInGroup(opts.group!, id, -1)}
            >
              ▲
            </button>
            <button
              className="icon-btn order-btn"
              title="Start later"
              disabled={opts.index === (opts.count ?? 1) - 1}
              onClick={() => onMoveInGroup(opts.group!, id, 1)}
            >
              ▼
            </button>
          </span>
        )}
        {opts.pinStar && (
          <button
            className="icon-btn pin-btn pinned"
            title="Unpin"
            onClick={() => onTogglePin(item.repoPath, item)}
          >
            ★
          </button>
        )}
        <div className="config-info" title={`${item.command}  (${item.cwd})`}>
          <span className="config-name">
            {opts.group && <span className="config-repo">{repoLabel(item.repoPath)} / </span>}
            {item.name}
          </span>
          <span className="config-command">{item.command}</span>
        </div>
        <div className="config-actions">
          {opts.pinStar && groups.length > 0 && (
            <select
              className="group-select"
              value=""
              title="Add to group"
              onChange={(e) => {
                if (e.target.value) onAddToGroup(e.target.value, item);
              }}
            >
              <option value="">+▾</option>
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {isRunning ? (
            <button className="mini-btn danger" onClick={() => onStop(id)}>
              ■ Stop
            </button>
          ) : (
            <button
              className="mini-btn run"
              onClick={() => onStart(item.repoPath, item.name, item.command, item.cwd)}
            >
              ▶ Run
            </button>
          )}
          {opts.group && (
            <button
              className="icon-btn danger"
              title="Remove from group"
              onClick={async () => {
                if (await confirmAsk(`Remove "${item.name}" from group "${opts.group}"? It stays pinned in favorites.`)) {
                  onRemoveFromGroup(opts.group!, id);
                }
              }}
            >
              ✕
            </button>
          )}
        </div>
      </li>
    );
  };

  const runningSessions = sessions.filter((s) => s.status === "running");

  return (
    <div className="run-view">
      <div className="run-configs" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="favorites-header">
          <span className="favorites-title">★ Favorites ({total})</span>
          <span className="group-actions">
            {runningSessions.length > 0 && (
              <button
                className="mini-btn danger"
                title="Stop every running process"
                onClick={() => runningSessions.forEach((s) => onStop(s.id))}
              >
                ■ Stop all ({runningSessions.length})
              </button>
            )}
            <button
              className="mini-btn run"
              disabled={idleFavorites.length === 0}
              onClick={() => runItems(allFavorites)}
            >
              ▶ Run all
              {idleFavorites.length > 0 && idleFavorites.length < total
                ? ` (${idleFavorites.length})`
                : ""}
            </button>
          </span>
        </div>

        <div className="section-header">
          <span>Groups</span>
          <button className="mini-btn" onClick={() => setShowNewGroup(!showNewGroup)}>
            {showNewGroup ? "Cancel" : "+ New group"}
          </button>
        </div>
        {showNewGroup && (
          <form
            className="add-config-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newGroupName.trim();
              if (!name) return;
              onAddGroup(name);
              // open the fresh group so its (empty) contents are visible
              setExpandedPersist((prev) => new Set(prev).add(name));
              setNewGroupName("");
              setShowNewGroup(false);
            }}
          >
            <input
              placeholder="Group name (e.g. backends)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
            />
            <button className="mini-btn" type="submit">
              Create
            </button>
          </form>
        )}
        {groups.length === 0 && !showNewGroup && (
          <div className="config-hint">
            Create a group (backends, apps, …), then use the +▾ on any favorite to add it. Run the
            whole group with one click.
          </div>
        )}
        {groups.map((g) => {
          const runningCount = g.items.filter((i) => runningIds.has(idFor(i.repoPath, i.name))).length;
          const isStarting = startingGroup === g.name;
          const isCollapsed = !expanded.has(g.name);
          const delay = g.delaySeconds ?? 3;
          return (
            <div
              key={g.name}
              className={`group-block ${dragOverGroup === g.name && dragGroup !== g.name ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverGroup(g.name);
              }}
              onDragLeave={() => setDragOverGroup((cur) => (cur === g.name ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragGroup) onReorderGroups(dragGroup, g.name);
                setDragGroup(null);
                setDragOverGroup(null);
              }}
            >
              <div
                className="group-header"
                draggable
                onDragStart={() => setDragGroup(g.name)}
                onDragEnd={() => {
                  setDragGroup(null);
                  setDragOverGroup(null);
                }}
              >
                <button
                  className="icon-btn group-icon"
                  title="Change icon"
                  onClick={() => setIconPickerFor(iconPickerFor === g.name ? null : g.name)}
                >
                  {g.icon ?? "📁"}
                </button>
                <button
                  className="group-name"
                  title={`${g.items.length} config(s), started top to bottom`}
                  onClick={() => toggleCollapsed(g.name)}
                >
                  {isCollapsed ? "▸" : "▾"} {g.name} ({g.items.length})
                  {isCollapsed && runningCount > 0 && <span className="running-dot" />}
                </button>
                <span className="group-actions">
                  <label className="delay-label" title="Seconds to wait between each start">
                    ⏱
                    <input
                      className="delay-input"
                      type="number"
                      min={0}
                      max={600}
                      value={delay}
                      onChange={(e) =>
                        onSetGroupDelay(g.name, Math.max(0, Number(e.target.value) || 0))
                      }
                    />
                    s
                  </label>
                  {runningCount > 0 && (
                    <button className="mini-btn danger" onClick={() => stopItems(g.items)}>
                      ■ Stop ({runningCount})
                    </button>
                  )}
                  <button
                    className="mini-btn run"
                    disabled={isStarting || g.items.length === 0 || runningCount === g.items.length}
                    onClick={() => runGroupSequential(g.name, g.items, delay)}
                    title={`Starts top to bottom, ${delay}s apart`}
                  >
                    {isStarting ? "⏳ Starting…" : "▶ Run group"}
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete group"
                    onClick={async () => {
                      if (await confirmAsk(`Delete group "${g.name}"? Its configs stay pinned in favorites.`)) {
                        onRemoveGroup(g.name);
                      }
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {iconPickerFor === g.name && (
                <div className="icon-picker">
                  {GROUP_ICONS.map((icon) => (
                    <button
                      key={icon}
                      className={`icon-btn ${g.icon === icon ? "active" : ""}`}
                      onClick={() => {
                        onSetGroupIcon(g.name, icon);
                        setIconPickerFor(null);
                      }}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              )}
              {!isCollapsed &&
                (g.items.length === 0 ? (
                  <div className="config-hint">Empty — add favorites with the +▾ button below.</div>
                ) : (
                  <ul className="config-list">
                    {g.items.map((i, idx) =>
                      itemRow(i, { group: g.name, index: idx, count: g.items.length })
                    )}
                  </ul>
                ))}
            </div>
          );
        })}

        <div className="section-header remotes-toggle" onClick={toggleAllFavorites}>
          <span>
            {showAllFavorites ? "▾" : "▸"} All favorites ({total})
          </span>
        </div>
        {total === 0 && (
          <div className="config-hint">
            Nothing pinned yet. Open a repo's Run tab and click the ☆ on any config — it will show
            up here for one-click access across all repos.
          </div>
        )}
        {showAllFavorites &&
          entries.map(({ repoPath, configs }) => (
            <div key={repoPath}>
              <div className="config-group-label" title={repoPath}>
                {repoLabel(repoPath)}
              </div>
              <ul className="config-list">
                {configs.map((c) => itemRow({ ...c, repoPath }, { pinStar: true }))}
              </ul>
            </div>
          ))}
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
              {repoLabel(s.repoPath)} / {s.name}
              {s.status === "exited" && s.exitCode !== null && s.exitCode !== 0 && ` (${s.exitCode})`}
            </button>
          ))}
          {sessions.length === 0 && (
            <span className="config-hint">Run a favorite to see its output here.</span>
          )}
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
