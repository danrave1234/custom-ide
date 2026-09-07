import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import type {
  CustomConfig,
  GroupItem,
  OutputLine,
  PersistedState,
  RepoInfo,
  RunChangeEvent,
  RunExitEvent,
  RunGroup,
  RunOutputBatchEvent,
  RunSession,
} from "./types";
import Sidebar from "./components/Sidebar";
import ChangesView from "./components/ChangesView";
import BranchesView from "./components/BranchesView";
import HistoryView from "./components/HistoryView";
import RunView from "./components/RunView";
import FavoritesView from "./components/FavoritesView";
import SyncView from "./components/SyncView";
import EnvView from "./components/EnvView";
import OutputDrawer from "./components/OutputDrawer";
import KillPortModal from "./components/KillPortModal";
import TerminalDrawer from "./components/TerminalDrawer";
import { useResizable } from "./useResizable";
import "./App.css";

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

type Tab = "changes" | "branches" | "history" | "run" | "env";
type View = "repo" | "favorites" | "sync";

const DEFAULT_SYNC_PREFS = {
  branch: "dev-release",
  selected: [] as string[],
  autostash: true,
  runBuild: false,
  buildCommand: "pnpm run build",
  push: false,
};

// rolling terminal buffer: keep the newest MAX_LINES, drop the oldest.
// SLACK avoids re-slicing the array on every append.
const MAX_LINES = 500;
const TRIM_SLACK = 100;

export default function App() {
  const [persisted, setPersisted] = useState<PersistedState | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [view, setView] = useState<View>("favorites");
  const [tab, setTab] = useState<Tab>("changes");
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("vd-sidebar-open") === "1");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [killPortOpen, setKillPortOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const toggleTerminal = () => setTerminalOpen((v) => !v);

  // Ctrl+` toggles the terminal, like VS Code
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      localStorage.setItem("vd-sidebar-open", open ? "0" : "1");
      return !open;
    });
  };
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<RunSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarWidth, onSidebarResize] = useResizable("vd-sidebar-w", 250, 180, 480);
  const [drawerOpen, setDrawerOpen] = useState(() => localStorage.getItem("vd-drawer-open") === "1");

  const toggleDrawer = () => {
    setDrawerOpen((open) => {
      localStorage.setItem("vd-drawer-open", open ? "0" : "1");
      return !open;
    });
  };

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const stoppedRunIds = useRef<Set<string>>(new Set());
  const autoRestartingIds = useRef<Set<string>>(new Set());

  const showError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const persist = useCallback(
    (next: PersistedState) => {
      setPersisted(next);
      api
        .savePersistedState(next)
        .then(() =>
          setLastSaved(
            new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          )
        )
        .catch((e) => showError(`Failed to save settings — changes will be lost on close!\n${e}`));
    },
    [showError]
  );

  const openWorkspace = useCallback(
    async (dir: string, state?: PersistedState) => {
      setScanning(true);
      setError(null);
      try {
        const found = await api.scanRepos(dir);
        setRoot(dir);
        setRepos(found);
        setSelectedRepo((prev) =>
          prev && found.some((r) => r.path === prev) ? prev : found[0]?.path ?? null
        );
        const base = state ?? persisted;
        if (base) {
          const recents = [dir, ...base.recentRoots.filter((r) => r !== dir)].slice(0, 8);
          persist({ ...base, lastRoot: dir, recentRoots: recents });
        }
      } catch (e) {
        showError(String(e));
      } finally {
        setScanning(false);
      }
    },
    [persisted, persist, showError]
  );

  // initial load: restore persisted state and reopen last workspace
  useEffect(() => {
    api.recordBuildInfo(__BUILD_TIME__);
    api
      .loadPersistedState()
      .then((state) => {
        setPersisted(state);
        if (state.lastRoot) {
          openWorkspace(state.lastRoot, state);
        }
      })
      .catch((e) => showError(`Failed to load saved settings: ${e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // process output / exit events — batches from the backend are coalesced
  // further here so heavy node output causes at most ~12 renders per second
  const pendingOutput = useRef<Map<string, OutputLine[]>>(new Map());
  const flushTimer = useRef<number | null>(null);

  const flushOutput = useCallback(() => {
    flushTimer.current = null;
    const pending = pendingOutput.current;
    if (pending.size === 0) return;
    pendingOutput.current = new Map();
    setSessions((prev) =>
      prev.map((s) => {
        const add = pending.get(s.id);
        if (!add) return s;
        let lines = s.lines.concat(add);
        if (lines.length > MAX_LINES + TRIM_SLACK) {
          lines = lines.slice(lines.length - MAX_LINES);
        }
        return { ...s, lines };
      })
    );
  }, []);

  useEffect(() => {
    const unlistenOutput = listen<RunOutputBatchEvent>("run-output", (event) => {
      const { id, lines } = event.payload;
      const prev = pendingOutput.current.get(id) ?? [];
      let next = prev.concat(
        lines.map((l) => ({ text: l.line, stream: l.stream } as OutputLine))
      );
      // even the staging buffer stays bounded if the window is throttled
      if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES);
      pendingOutput.current.set(id, next);
      if (flushTimer.current === null) {
        flushTimer.current = window.setTimeout(flushOutput, 80);
      }
    });
    const unlistenExit = listen<RunExitEvent>("run-exit", (event) => {
      flushOutput(); // keep output ordered before the exit marker
      const { id, code } = event.payload;
      // a finished process may have changed branch/dirty state — refresh that repo
      const repoPath = id.split("::")[0];
      api
        .refreshRepo(repoPath)
        .then((info) => setRepos((prev) => prev.map((r) => (r.path === info.path ? info : r))))
        .catch(() => {});
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: code === 0 || code === null ? "exited" : "failed",
                exitCode: code,
                lines: [
                  ...s.lines,
                  { text: `— process exited with code ${code ?? "?"} —`, stream: "system" as const },
                ],
              }
            : s
        )
      );
    });
    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenExit.then((fn) => fn());
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    };
  }, [flushOutput]);

  const refreshSelectedRepo = useCallback(async () => {
    if (!selectedRepo) return;
    try {
      const info = await api.refreshRepo(selectedRepo);
      setRepos((prev) => prev.map((r) => (r.path === info.path ? info : r)));
    } catch {
      // repo may have been deleted; a full rescan will pick that up
    }
  }, [selectedRepo]);

  const pickAndOpen = async () => {
    try {
      const dir = await api.pickFolder();
      if (dir) await openWorkspace(dir);
    } catch (e) {
      showError(String(e));
    }
  };

  const startRun = useCallback(
    async (
      repoPath: string,
      name: string,
      command: string,
      cwd: string,
      restartMessage?: string
    ) => {
      const id = `${repoPath}::${name}`;
      const existing = sessionsRef.current.find((s) => s.id === id);
      if (existing?.status === "running") {
        showError("That run is already active.");
        return;
      }
      const fresh: RunSession = {
        id,
        name,
        command,
        cwd,
        repoPath,
        status: "running",
        autoRestart: true,
        exitCode: null,
        lines: [
          ...(restartMessage ? [{ text: restartMessage, stream: "system" as const }] : []),
          { text: `▶ ${command}   (${cwd})`, stream: "system" },
        ],
      };
      stoppedRunIds.current.delete(id);
      setSessions((prev) => [...prev.filter((s) => s.id !== id), fresh]);
      setActiveSessionId(id);
      try {
        await api.startRun(id, cwd, command);
        await api.watchRunChanges(id, repoPath).catch((e) => {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === id
                ? {
                    ...s,
                    lines: [
                      ...s.lines,
                      { text: `Auto-restart unavailable: ${e}`, stream: "system" as const },
                    ],
                  }
                : s
            )
          );
        });
      } catch (e) {
        api.unwatchRunChanges(id).catch(() => {});
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, status: "failed", lines: [...s.lines, { text: String(e), stream: "system" }] }
              : s
          )
        );
      }
    },
    [showError]
  );

  const stopRun = useCallback((id: string) => {
    stoppedRunIds.current.add(id);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, autoRestart: false } : s))
    );
    api.unwatchRunChanges(id).catch(() => {});
    api.stopRun(id).catch((e) => setError(String(e)));
  }, []);

  // kill (if running), wait for the process to actually exit, then start again
  const restartRun = useCallback(
    async (session: RunSession, automatic = false) => {
      const current = sessionsRef.current.find((s) => s.id === session.id);
      if (current?.status === "running") {
        try {
          await api.stopRun(session.id);
        } catch {
          // already gone — fine, we only care that it isn't running anymore
        }
        for (let i = 0; i < 40; i++) {
          const running = await api.listRunning().catch(() => [] as string[]);
          if (!running.includes(session.id)) break;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (automatic && stoppedRunIds.current.has(session.id)) return;
      await startRun(
        session.repoPath,
        session.name,
        session.command,
        session.cwd,
        automatic ? "↻ Local changes detected — restarting automatically" : undefined
      );
    },
    [startRun]
  );

  useEffect(() => {
    const unlistenChange = listen<RunChangeEvent>("run-change", (event) => {
      for (const id of event.payload.ids) {
        const session = sessionsRef.current.find((candidate) => candidate.id === id);
        if (
          !session?.autoRestart ||
          stoppedRunIds.current.has(id) ||
          autoRestartingIds.current.has(id)
        ) {
          continue;
        }
        autoRestartingIds.current.add(id);
        void restartRun(session, true).finally(() => autoRestartingIds.current.delete(id));
      }
    });
    return () => {
      unlistenChange.then((fn) => fn());
    };
  }, [restartRun]);

  const clearRun = useCallback((id: string) => {
    const target = sessionsRef.current.find((s) => s.id === id);
    if (target && target.status !== "running") {
      stoppedRunIds.current.add(id);
      api.unwatchRunChanges(id).catch(() => {});
    }
    setSessions((prev) => {
      const current = prev.find((s) => s.id === id);
      if (!current) return prev;
      if (current.status === "running") {
        return prev.map((s) => (s.id === id ? { ...s, lines: [] } : s));
      }
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const customConfigs = (selectedRepo && persisted?.customConfigs[selectedRepo]) || [];
  const pinnedConfigs = (selectedRepo && persisted?.pinnedConfigs[selectedRepo]) || [];

  const togglePin = (repoPath: string, config: CustomConfig) => {
    if (!persisted) return;
    const forRepo = persisted.pinnedConfigs[repoPath] ?? [];
    const isPinned = forRepo.some((c) => c.name === config.name);
    persist({
      ...persisted,
      pinnedConfigs: {
        ...persisted.pinnedConfigs,
        [repoPath]: isPinned
          ? forRepo.filter((c) => c.name !== config.name)
          : [...forRepo, config],
      },
    });
  };

  // everything favorites-related is scoped to the open workspace (project)
  const isUnderRoot = useCallback(
    (p: string) => {
      if (!root) return false;
      const a = p.toLowerCase();
      const b = root.toLowerCase();
      return a === b || a.startsWith(b + "\\") || a.startsWith(b + "/");
    },
    [root]
  );

  const projectPinned = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(persisted?.pinnedConfigs ?? {}).filter(([p]) => isUnderRoot(p))
      ),
    [persisted, isUnderRoot]
  );

  const projectSessions = useMemo(
    () => sessions.filter((s) => isUnderRoot(s.repoPath)),
    [sessions, isUnderRoot]
  );

  const totalFavorites = Object.values(projectPinned).reduce((n, list) => n + list.length, 0);

  const itemKey = (i: GroupItem) => `${i.repoPath}::${i.name}`;

  const currentGroups = () => (root && persisted?.groupsByRoot?.[root]) || [];

  const setGroups = (groups: RunGroup[]) => {
    if (!persisted || !root) return;
    persist({
      ...persisted,
      groupsByRoot: { ...(persisted.groupsByRoot ?? {}), [root]: groups },
    });
  };

  const addGroup = (name: string) => {
    if (currentGroups().some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      showError(`A group named "${name}" already exists.`);
      return;
    }
    setGroups([...currentGroups(), { name, items: [], delaySeconds: 3 }]);
  };

  const removeGroup = (name: string) => {
    setGroups(currentGroups().filter((g) => g.name !== name));
  };

  const addToGroup = (groupName: string, item: GroupItem) => {
    setGroups(
      currentGroups().map((g) =>
        g.name === groupName && !g.items.some((i) => itemKey(i) === itemKey(item))
          ? { ...g, items: [...g.items, item] }
          : g
      )
    );
  };

  const removeFromGroup = (groupName: string, key: string) => {
    setGroups(
      currentGroups().map((g) =>
        g.name === groupName ? { ...g, items: g.items.filter((i) => itemKey(i) !== key) } : g
      )
    );
  };

  const moveInGroup = (groupName: string, key: string, delta: -1 | 1) => {
    setGroups(
      currentGroups().map((g) => {
        if (g.name !== groupName) return g;
        const items = [...g.items];
        const from = items.findIndex((i) => itemKey(i) === key);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= items.length) return g;
        [items[from], items[to]] = [items[to], items[from]];
        return { ...g, items };
      })
    );
  };

  const setGroupDelay = (groupName: string, delaySeconds: number) => {
    setGroups(currentGroups().map((g) => (g.name === groupName ? { ...g, delaySeconds } : g)));
  };

  const setGroupIcon = (groupName: string, icon: string) => {
    setGroups(currentGroups().map((g) => (g.name === groupName ? { ...g, icon } : g)));
  };

  const syncPrefs =
    (root && persisted?.syncPrefs?.[root]) || DEFAULT_SYNC_PREFS;

  const saveSyncPrefs = (prefs: typeof DEFAULT_SYNC_PREFS) => {
    if (!persisted || !root) return;
    persist({
      ...persisted,
      syncPrefs: { ...(persisted.syncPrefs ?? {}), [root]: prefs },
    });
  };

  // drop `srcName` at `destName`'s position
  const reorderGroups = (srcName: string, destName: string) => {
    if (srcName === destName) return;
    const groups = [...currentGroups()];
    const from = groups.findIndex((g) => g.name === srcName);
    const to = groups.findIndex((g) => g.name === destName);
    if (from < 0 || to < 0) return;
    const [moved] = groups.splice(from, 1);
    groups.splice(to, 0, moved);
    setGroups(groups);
  };

  const addCustomConfig = (config: CustomConfig) => {
    if (!persisted || !selectedRepo) return;
    const forRepo = persisted.customConfigs[selectedRepo] ?? [];
    persist({
      ...persisted,
      customConfigs: {
        ...persisted.customConfigs,
        [selectedRepo]: [...forRepo.filter((c) => c.name !== config.name), config],
      },
    });
  };

  const removeCustomConfig = (name: string) => {
    if (!persisted || !selectedRepo) return;
    const forRepo = persisted.customConfigs[selectedRepo] ?? [];
    persist({
      ...persisted,
      customConfigs: {
        ...persisted.customConfigs,
        [selectedRepo]: forRepo.filter((c) => c.name !== name),
      },
    });
  };

  const runningByRepo = sessions.reduce<Record<string, number>>((acc, s) => {
    if (s.status === "running") acc[s.repoPath] = (acc[s.repoPath] ?? 0) + 1;
    return acc;
  }, {});
  const totalRunning = Object.values(runningByRepo).reduce((a, b) => a + b, 0);

  const repoSessions = sessions.filter((s) => s.repoPath === selectedRepo);
  const workspaceName = root ? root.split(/[\\/]/).filter(Boolean).pop() : null;

  if (!root) {
    return (
      <div className="welcome">
        <h1>⚡ VibeDeck</h1>
        <p>Git branches, diffs and run configs for AI-assisted coding — without the IDE weight.</p>
        <button className="primary-btn big" onClick={pickAndOpen}>
          Open workspace folder
        </button>
        {(persisted?.recentRoots.length ?? 0) > 0 && (
          <div className="recent-roots">
            <div className="section-header"><span>Recent</span></div>
            {persisted!.recentRoots.map((r) => (
              <button key={r} className="recent-root" onClick={() => openWorkspace(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
        {error && <div className="error-bar">{error}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className={`icon-btn hamburger ${sidebarOpen ? "active" : ""}`}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          onClick={toggleSidebar}
        >
          ☰
        </button>
        <span className="app-name">⚡ VibeDeck</span>
        <div className="workspace-switcher">
          <button
            className="workspace-name ws-button"
            title={root}
            onClick={() => setSwitcherOpen(!switcherOpen)}
          >
            {workspaceName} ▾
          </button>
          {switcherOpen && (
            <>
              <div className="ws-backdrop" onClick={() => setSwitcherOpen(false)} />
              <div className="ws-dropdown">
                <div className="ws-section">Recent workspaces</div>
                {(persisted?.recentRoots ?? []).map((r) => (
                  <button
                    key={r}
                    className={`ws-item ${r === root ? "current" : ""}`}
                    title={r}
                    onClick={() => {
                      setSwitcherOpen(false);
                      if (r !== root) openWorkspace(r);
                    }}
                  >
                    {r === root ? "● " : ""}
                    {r.split(/[\\/]/).filter(Boolean).pop()}
                    <span className="ws-path">{r}</span>
                  </button>
                ))}
                <div className="ws-divider" />
                <button
                  className="ws-item"
                  onClick={() => {
                    setSwitcherOpen(false);
                    pickAndOpen();
                  }}
                >
                  📂 Open folder…
                </button>
                <button
                  className="ws-item"
                  onClick={() => {
                    setSwitcherOpen(false);
                    api.newWindow().catch((e) => showError(String(e)));
                  }}
                >
                  🗗 New window
                </button>
              </div>
            </>
          )}
        </div>
        {totalRunning > 0 && (
          <span className="running-indicator">
            <span className="running-dot" /> {totalRunning} running
          </span>
        )}
        <span className="topbar-spacer" />
        <span className="build-stamp" title={`VibeDeck ${__APP_VERSION__}, built ${__BUILD_TIME__}`}>
          v{__APP_VERSION__} · build {__BUILD_TIME__}
        </span>
        {lastSaved && (
          <span className="save-stamp" title="Settings last written to disk">
            saved {lastSaved}
          </span>
        )}
        <button
          className={`mini-btn ${terminalOpen ? "active-btn" : ""}`}
          onClick={toggleTerminal}
          title="Toggle terminal (Ctrl+`)"
        >
          &gt;_ Terminal
        </button>
        <button className="mini-btn" onClick={() => setKillPortOpen(true)}>
          🔌 Kill port
        </button>
        <button className="mini-btn" onClick={pickAndOpen}>
          Open folder…
        </button>
      </header>
      {killPortOpen && <KillPortModal onClose={() => setKillPortOpen(false)} />}

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="main">
        {sidebarOpen && (
          <>
            <Sidebar
              repos={repos}
              selected={view === "repo" ? selectedRepo : null}
              runningByRepo={runningByRepo}
              onSelect={(path) => {
                setSelectedRepo(path);
                setView("repo");
              }}
              onRefresh={() => openWorkspace(root)}
              loading={scanning}
              favoritesCount={totalFavorites}
              favoritesSelected={view === "favorites"}
              onSelectFavorites={() => setView("favorites")}
              syncSelected={view === "sync"}
              onSelectSync={() => setView("sync")}
              width={sidebarWidth}
            />
            <div className="resizer" onMouseDown={onSidebarResize} />
          </>
        )}
        <section className="content">
          {view === "sync" ? (
            <SyncView
              repos={repos}
              prefs={syncPrefs}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSavePrefs={saveSyncPrefs}
              onStart={startRun}
              onStop={stopRun}
              onClear={clearRun}
              onSelectSession={setActiveSessionId}
              onError={showError}
            />
          ) : view === "favorites" ? (
            <FavoritesView
              repos={repos}
              pinnedByRepo={projectPinned}
              groups={currentGroups()}
              sessions={projectSessions}
              activeSessionId={activeSessionId}
              onStart={startRun}
              onRestart={restartRun}
              onStop={stopRun}
              onClear={clearRun}
              onSelectSession={setActiveSessionId}
              onTogglePin={togglePin}
              onError={showError}
              onAddGroup={addGroup}
              onRemoveGroup={removeGroup}
              onAddToGroup={addToGroup}
              onRemoveFromGroup={removeFromGroup}
              onMoveInGroup={moveInGroup}
              onSetGroupDelay={setGroupDelay}
              onSetGroupIcon={setGroupIcon}
              onReorderGroups={reorderGroups}
            />
          ) : selectedRepo ? (
            <>
              <nav className="tabs">
                {(["changes", "branches", "history", "run", "env"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    className={`tab ${tab === t ? "active" : ""}`}
                    onClick={() => setTab(t)}
                  >
                    {t === "run" && (runningByRepo[selectedRepo] ?? 0) > 0 ? "run ●" : t}
                  </button>
                ))}
              </nav>
              <div className="tab-content">
                {tab === "changes" && (
                  <ChangesView
                    repoPath={selectedRepo}
                    onError={showError}
                    onRepoChanged={refreshSelectedRepo}
                  />
                )}
                {tab === "branches" && (
                  <BranchesView
                    repoPath={selectedRepo}
                    onError={showError}
                    onRepoChanged={refreshSelectedRepo}
                  />
                )}
                {tab === "history" && <HistoryView repoPath={selectedRepo} onError={showError} />}
                {tab === "env" && <EnvView repoPath={selectedRepo} onError={showError} />}
                {tab === "run" && (
                  <RunView
                    repoPath={selectedRepo}
                    sessions={repoSessions}
                    activeSessionId={activeSessionId}
                    customConfigs={customConfigs}
                    pinnedConfigs={pinnedConfigs}
                    onTogglePin={(config) => togglePin(selectedRepo, config)}
                    onStart={(name, command, cwd) => startRun(selectedRepo, name, command, cwd)}
                    onRestart={restartRun}
                    onStop={stopRun}
                    onClear={clearRun}
                    onSelectSession={setActiveSessionId}
                    onAddCustom={addCustomConfig}
                    onRemoveCustom={removeCustomConfig}
                    onError={showError}
                  />
                )}
              </div>
              {tab !== "run" && (
                <OutputDrawer
                  sessions={sessions}
                  repos={repos}
                  activeSessionId={activeSessionId}
                  open={drawerOpen}
                  onToggle={toggleDrawer}
                  onSelectSession={setActiveSessionId}
                  onRestart={restartRun}
                  onStop={stopRun}
                  onClear={clearRun}
                  onError={showError}
                />
              )}
            </>
          ) : (
            <div className="diff-empty">Select a repository</div>
          )}
        </section>
      </div>

      <TerminalDrawer
        open={terminalOpen}
        onToggle={toggleTerminal}
        defaultCwd={(view === "repo" && selectedRepo) || root}
        defaultLabel={
          view === "repo" && selectedRepo
            ? selectedRepo.split(/[\\/]/).filter(Boolean).pop() ?? "shell"
            : workspaceName ?? "shell"
        }
      />
    </div>
  );
}
