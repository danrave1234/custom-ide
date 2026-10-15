import { useState, useRef, useEffect } from "react";
import { confirmAsk } from "../api";
import type { CustomConfig, GroupItem, RepoInfo, RunGroup, RunSession } from "../types";
import SessionOutput from "./SessionOutput";
import { useResizable } from "../useResizable";
import { Star, Play, Stop as StopIcon, MoreVertical, Clock, Palette, Edit, Trash, ChevronRight, ChevronDown, Plus } from "./Icons";

const GROUP_ICONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];

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
  onRenameGroup: (oldName: string, newName: string) => void;
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
  onRenameGroup,
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
  // Drag-and-drop for individual favorites into groups
  const [draggingFavorite, setDraggingFavorite] = useState<GroupItem | null>(null);
  const [dragOverGroupForItem, setDragOverGroupForItem] = useState<string | null>(null);
  // Multi-select for bulk operations
  const [selectedFavorites, setSelectedFavorites] = useState<Set<string>>(new Set());
  // Overflow menu state per group
  const [groupMenuFor, setGroupMenuFor] = useState<string | null>(null);
  const groupMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [groupMenuRect, setGroupMenuRect] = useState<{ top: number; right: number } | null>(null);
  const [addPanelGroup, setAddPanelGroup] = useState<string | null>(null);
  // Inline rename state
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Position group menu at button rect when opened
  useEffect(() => {
    if (groupMenuFor && groupMenuBtnRef.current) {
      const rect = groupMenuBtnRef.current.getBoundingClientRect();
      setGroupMenuRect({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    } else {
      setGroupMenuRect(null);
    }
  }, [groupMenuFor]);

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

  // Bulk selection helpers
  const toggleFavoriteSelection = (item: GroupItem) => {
    const key = idFor(item.repoPath, item.name);
    setSelectedFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => setSelectedFavorites(new Set());

  // Add selected favorites to a group
  const addSelectedToGroup = (groupName: string) => {
    for (const key of selectedFavorites) {
      const item = allFavorites.find((f) => idFor(f.repoPath, f.name) === key);
      if (item) onAddToGroup(groupName, item);
    }
    clearSelection();
  };

  // Create a new group from selected favorites
  const createGroupFromSelected = () => {
    if (selectedFavorites.size === 0) return;
    const name = `Group ${groups.length + 1}`;
    onAddGroup(name);
    setExpanded((prev) => new Set(prev).add(name));
    addSelectedToGroup(name);
  };

  // Drag favorite into group handler
  const handleDropFavoriteOnGroup = (item: GroupItem, groupName: string) => {
    onAddToGroup(groupName, item);
    setDraggingFavorite(null);
    setDragOverGroupForItem(null);
  };

  // Inline rename handler
  const startRename = (groupName: string) => {
    setRenamingGroup(groupName);
    setRenameValue(groupName);
  };

  const commitRename = (oldName: string) => {
    const newName = renameValue.trim();
    if (newName && newName !== oldName) {
      onRenameGroup(oldName, newName);
    }
    setRenamingGroup(null);
    setRenameValue("");
  };

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

  const itemRow = (
    item: GroupItem,
    opts: { group?: string; pinStar?: boolean; index?: number; count?: number }
  ) => {
    const id = idFor(item.repoPath, item.name);
    const isRunning = runningIds.has(id);
    const isSelected = selectedFavorites.has(id);
    const isInGroup = opts.group ? groups.find((g) => g.name === opts.group)?.items.some((i) => itemKey(i) === id) ?? false : false;
    return (
      <li className={`config-row ${isSelected ? "selected-row" : ""}`} key={`${opts.group ?? "fav"}-${id}`}>
        {opts.group && (
          <span className="order-controls">
            <span className="order-no">{(opts.index ?? 0) + 1}</span>
            <button
              className="icon-btn order-btn"
              title="Start earlier"
              disabled={opts.index === 0}
              onClick={() => onMoveInGroup(opts.group!, id, -1)}
            >
              <ChevronRight size={10} />
            </button>
            <button
              className="icon-btn order-btn"
              title="Start later"
              disabled={opts.index === (opts.count ?? 1) - 1}
              onClick={() => onMoveInGroup(opts.group!, id, 1)}
            >
              <ChevronDown size={10} />
            </button>
          </span>
        )}
        {opts.pinStar && (
          <button
            type="button"
            className={`icon-btn check-btn ${isSelected ? "checked" : ""}`}
            title="Select for bulk operations"
            onClick={() => toggleFavoriteSelection(item)}
          >
            {isSelected ? "✓" : ""}
          </button>
        )}
        <div
          className="config-info"
          title={`${item.command}  (${item.cwd})`}
          draggable={opts.pinStar}
          onDragStart={(e) => {
            if (opts.pinStar) {
              setDraggingFavorite(item);
              e.dataTransfer.effectAllowed = "copy";
            }
          }}
          onDragEnd={() => setDraggingFavorite(null)}
        >
          <span className="config-name">
            {opts.group && <span className="config-repo">{repoLabel(item.repoPath)} / </span>}
            {item.name}
          </span>
          <span className="config-command">{item.command}</span>
        </div>
        <div className="config-actions">
          {opts.pinStar && (
            <button
              className="icon-btn unpin-btn"
              title="Unpin"
              onClick={() => onTogglePin(item.repoPath, item)}
            >
              <Star size={12} filled />
            </button>
          )}
          {opts.pinStar && groups.length > 0 && !isInGroup && (
            <select
              className="group-select"
              value=""
              title="Add to group"
              onChange={(e) => {
                if (e.target.value) onAddToGroup(e.target.value, item);
              }}
            >
              <option value="">+ Add to…</option>
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {isRunning ? (
            <button className="mini-btn danger" onClick={() => onStop(id)}>
              <StopIcon size={10} /> Stop
            </button>
          ) : (
            <button
              className="mini-btn run"
              onClick={() => onStart(item.repoPath, item.name, item.command, item.cwd)}
            >
              <Play size={10} /> Run
            </button>
          )}
          {opts.group && (
            <button
              className="icon-btn danger"
              title="Remove from group"
              onClick={() => onRemoveFromGroup(opts.group!, id)}
            >
              <Trash size={10} />
            </button>
          )}
        </div>
      </li>
    );
  };

  const itemKey = (i: GroupItem) => `${i.repoPath}::${i.name}`;

  const runningSessions = sessions.filter((s) => s.status === "running");

  return (
    <div className="run-view">
      <div className="run-configs" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="favorites-header">
          <span className="favorites-title">Favorites ({total})</span>
          <span className="group-actions">
            {selectedFavorites.size > 0 && (
              <>
                <span className="selection-count">{selectedFavorites.size} selected</span>
                <button
                  className="mini-btn"
                  onClick={clearSelection}
                >
                  Clear
                </button>
                {groups.length > 0 && (
                  <select
                    className="group-select"
                    value=""
                    title="Add selected to group"
                    onChange={(e) => {
                      if (e.target.value) addSelectedToGroup(e.target.value);
                    }}
                  >
                    <option value="">+ Add to…</option>
                    {groups.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
                <button className="mini-btn" onClick={createGroupFromSelected}>
                  New group
                </button>
              </>
            )}
            {runningSessions.length > 0 && (
              <button
                className="mini-btn danger"
                title="Stop every running process"
                onClick={() => runningSessions.forEach((s) => onStop(s.id))}
              >
                <StopIcon size={10} /> Stop all ({runningSessions.length})
              </button>
            )}
            <button
              className="mini-btn run"
              disabled={idleFavorites.length === 0}
              onClick={() => runItems(allFavorites)}
            >
              <Play size={10} /> Run all
              {idleFavorites.length > 0 && idleFavorites.length < total
                ? ` (${idleFavorites.length})`
                : ""}
            </button>
          </span>
        </div>

        <div className="section-header">
          <span>Groups</span>
          <button className="mini-btn" onClick={() => setShowNewGroup(!showNewGroup)}>
            {showNewGroup ? "Cancel" : <><Plus size={12} /> New group</>}
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
            Create a group (backends, apps, …), then use the "+ Add to…" dropdown on any favorite to add it. Run the
            whole group with one click.
          </div>
        )}
        {groups.map((g) => {
          const runningCount = g.items.filter((i) => runningIds.has(idFor(i.repoPath, i.name))).length;
          const isStarting = startingGroup === g.name;
          const isCollapsed = !expanded.has(g.name);
          const delay = g.delaySeconds ?? 3;
          const isDragOver = dragOverGroupForItem === g.name && draggingFavorite !== null;
          return (
            <div
              key={g.name}
              className={`group-block ${dragOverGroup === g.name && dragGroup !== g.name ? "drag-over" : ""} ${isDragOver ? "drag-over-item" : ""}`}
              onClick={() => {
                if (groupMenuFor === g.name) return;
                if (groupMenuFor && groupMenuFor !== g.name) setGroupMenuFor(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragGroup) setDragOverGroup(g.name);
                if (draggingFavorite) setDragOverGroupForItem(g.name);
              }}
              onDragLeave={() => {
                setDragOverGroup((cur) => (cur === g.name ? null : cur));
                setDragOverGroupForItem((cur) => (cur === g.name ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragGroup) {
                  onReorderGroups(dragGroup, g.name);
                  setDragGroup(null);
                  setDragOverGroup(null);
                }
                if (draggingFavorite) {
                  handleDropFavoriteOnGroup(draggingFavorite, g.name);
                }
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
                  title={g.icon ?? "A"}
                >
                  <span className="group-icon-letter">{g.icon ?? "A"}</span>
                </button>
                {renamingGroup === g.name ? (
                  <input
                    className="rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(g.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(g.name);
                      if (e.key === "Escape") {
                        setRenamingGroup(null);
                        setRenameValue("");
                      }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button
                    className="group-name"
                    title={`${g.items.length} config(s), started top to bottom`}
                    onClick={() => toggleCollapsed(g.name)}
                    onDoubleClick={() => startRename(g.name)}
                  >
                    {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />} {g.name} ({g.items.length})
                    {isCollapsed && runningCount > 0 && <span className="running-dot" />}
                  </button>
                )}
                <span className="group-actions">
                  {runningCount > 0 && (
                    <button className="mini-btn danger" onClick={(e) => { e.stopPropagation(); stopItems(g.items); }}>
                      <StopIcon size={10} /> Stop ({runningCount})
                    </button>
                  )}
                  <button
                    className="mini-btn run"
                    disabled={isStarting || g.items.length === 0 || runningCount === g.items.length}
                    onClick={(e) => { e.stopPropagation(); runGroupSequential(g.name, g.items, delay); }}
                    title={`Starts top to bottom, ${delay}s apart`}
                  >
                    {isStarting ? "Starting…" : <><Play size={10} /> Run group</>}
                  </button>
                  <div className="more-menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      ref={(el) => { groupMenuBtnRef.current = el; }}
                      className="icon-btn more-button"
                      title="More actions"
                      onClick={() => setGroupMenuFor(groupMenuFor === g.name ? null : g.name)}
                    >
                      <MoreVertical size={14} />
                    </button>
                    {groupMenuFor === g.name && groupMenuRect && (
                      <div
                        className="more-dropdown group-more-dropdown"
                        style={{
                          position: "fixed",
                          top: groupMenuRect.top,
                          right: groupMenuRect.right,
                        }}
                      >
                        <label className="menu-delay-row" title="Seconds to wait between each start">
                          <Clock size={12} /> Delay
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
                          <span>s</span>
                        </label>
                        <button onClick={() => { setIconPickerFor(iconPickerFor === g.name ? null : g.name); setGroupMenuFor(null); }}>
                          <Palette size={12} /> Change icon
                        </button>
                        <button onClick={() => { setAddPanelGroup(g.name); setGroupMenuFor(null); }}>
                          <Plus size={12} /> Add favorites
                        </button>
                        <button onClick={() => { startRename(g.name); setGroupMenuFor(null); }}>
                          <Edit size={12} /> Rename
                        </button>
                        <button
                          className="danger-item"
                          onClick={async () => {
                            setGroupMenuFor(null);
                            if (await confirmAsk(`Delete group "${g.name}"? Its configs stay pinned in favorites.`)) {
                              onRemoveGroup(g.name);
                            }
                          }}
                        >
                          <Trash size={12} /> Delete group
                        </button>
                      </div>
                    )}
                  </div>
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
              {addPanelGroup === g.name && (
                <div className="add-panel">
                  <div className="add-panel-title">Add to "{g.name}"</div>
                  {allFavorites.length === 0 ? (
                    <div className="config-hint">No favorites to add.</div>
                  ) : (
                    <ul className="config-list">
                      {allFavorites.map((fav) => {
                        const alreadyIn = g.items.some((i) => itemKey(i) === itemKey(fav));
                        return (
                          <li key={itemKey(fav)} className={`config-row ${alreadyIn ? "already-in-group" : ""}`}>
                            <div className="config-info">
                              <span className="config-name">
                                <span className="config-repo">{repoLabel(fav.repoPath)} / </span>
                                {fav.name}
                              </span>
                              <span className="config-command">{fav.command}</span>
                            </div>
                            <div className="config-actions">
                              {alreadyIn ? (
                                <span className="already-badge">✓ In group</span>
                              ) : (
                                <button
                                  className="mini-btn run"
                                  onClick={() => onAddToGroup(g.name, fav)}
                                >
                                  + Add
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              {!isCollapsed && addPanelGroup !== g.name &&
                (g.items.length === 0 ? (
                  <div className="config-hint">Empty — add favorites with the + Add button above or drag favorites here.</div>
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
            {showAllFavorites ? <ChevronDown size={10} /> : <ChevronRight size={10} />} All favorites ({total})
          </span>
        </div>
        {total === 0 && (
          <div className="config-hint">
            Nothing pinned yet. Open a repo's Run tab and star any config — it will show
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

      <SessionOutput
        sessions={sessions}
        activeSessionId={activeSessionId}
        repos={repos}
        onSelectSession={onSelectSession}
        onRestart={onRestart}
        onStop={onStop}
        onClear={onClear}
        onError={onError}
        emptyHint="Run a favorite to see its output here."
      />
    </div>
  );
}
