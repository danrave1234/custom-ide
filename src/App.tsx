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
import BottomPanel from "./components/BottomPanel";
import KillPortModal from "./components/KillPortModal";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import UpdateNotice from "./components/UpdateNotice";
import { Menu, ChevronDown, Close, Folder, Terminal as TerminalIcon } from "./components/Icons";
import { useResizable } from "./useResizable";
import { appendRunOutput } from "./outputBuffer";
import { useUpdater } from "./useUpdater";
import "./App.css";


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
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("vd-sidebar-open") !== "0");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [killPortOpen, setKillPortOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const updater = useUpdater();
  const [moreOpen, setMoreOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);

  const toggleBottom = () => setBottomOpen((v) => !v);

  // Global navigation shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setBottomOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setMoreOpen(false);
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
        let lines = appendRunOutput(s.lines, add);
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
          { text: `→ ${command}   (${cwd})`, stream: "system" },
        ],
      };
      stoppedRunIds.current.delete(id);
      setSessions((prev) => [...prev.filter((s) => s.id !== id), fresh]);
      setActiveSessionId(id);
      try {
        await api.startRun(id, cwd, command);
        // Watch the run's own folder (e.g. backend/), not the whole repo, so
        // churn from a sibling app (frontend dev server, temp files) can't
        // restart it.
        await api.watchRunChanges(id, cwd || repoPath).catch((e) => {
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

  // Auto-restart on file change
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

  // Agent API bridge: listen for agent-ui events and mirror them into UI actions
  useEffect(() => {
    const unlisten = listen<any>("agent-ui", (event) => {
      const { action, ...payload } = event.payload;
      switch (action) {
        case "openWorkspace": {
          if (payload.path) openWorkspace(payload.path);
          break;
        }
        case "selectRepo": {
          const target = payload.path ?? payload.name;
          if (target) {
            const found = repos.find(
              (r) => r.path === target || r.name.toLowerCase() === target.toLowerCase()
            );
            if (found) {
              setSelectedRepo(found.path);
              setView("repo");
              setError(null);
            }
          }
          break;
        }
        case "startRun": {
          const { name, command, cwd, repoPath } = payload;
          if (name && command && cwd) {
            startRun(repoPath ?? cwd, name, command, cwd);
            // Open bottom panel on output mode so agent runs are visible
            setBottomOpen(true);
          }
          break;
        }
        case "stopRun": {
          if (payload.id) stopRun(payload.id);
          break;
        }
        case "setView": {
          if (payload.view) setView(payload.view);
          if (payload.tab) setTab(payload.tab);
          break;
        }
        case "runGroup": {
          if (payload.name) {
            const groups = (root && persisted?.groupsByRoot?.[root]) || [];
            const group = groups.find((g) => g.name === payload.name);
            if (group && group.items.length) {
              setView("favorites");
              // Sequentially start items with delay
              let idx = 0;
              const next = () => {
                if (idx >= group.items.length) return;
                const item = group.items[idx];
                const itemKey = `${item.repoPath}::${item.name}`;
                const existing = sessionsRef.current.find((s) => s.id === itemKey);
                if (existing?.status !== "running") {
                  startRun(item.repoPath, item.name, item.command, item.cwd);
                }
                idx++;
                if (idx < group.items.length) {
                  setTimeout(next, (group.delaySeconds ?? 3) * 1000);
                }
              };
              next();
            }
          }
          break;
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openWorkspace, repos, startRun, stopRun, persisted, root, sessionsRef]);

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

  const renameGroup = (oldName: string, newName: string) => {
    if (oldName === newName) return;
    if (currentGroups().some((g) => g.name.toLowerCase() === newName.toLowerCase())) {
      showError(`A group named "${newName}" already exists.`);
      return;
    }
    setGroups(currentGroups().map((g) => (g.name === oldName ? { ...g, name: newName } : g)));
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
  const commandItems: CommandItem[] = root
    ? [
        ...repos.map((repo) => ({
          id: `repo-${repo.path}`,
          label: repo.name,
          detail: `${repo.branch} · ${repo.path}`,
          group: "Repository",
          keywords: "open switch",
          action: () => {
            setSelectedRepo(repo.path);
            setView("repo");
            setError(null);
            setSidebarOpen(true);
          },
        })),
        {
          id: "view-favorites",
          label: "Open Favorites",
          detail: `${totalFavorites} pinned run configurations`,
          group: "Navigate",
          action: () => setView("favorites"),
        },
        {
          id: "view-sync",
          label: "Open Sync repos",
          detail: "Fetch, rebase, and push repositories",
          group: "Navigate",
          action: () => setView("sync"),
        },
        ...(["changes", "branches", "history", "run", "env"] as Tab[]).map((targetTab) => ({
          id: `tab-${targetTab}`,
          label: `Open ${targetTab}`,
          detail: selectedRepo ? "Current repository" : "Select a repository first",
          group: "Navigate",
          action: () => {
            if (selectedRepo) {
              setView("repo");
              setTab(targetTab);
            }
          },
        })),
        {
          id: "action-terminal",
          label: bottomOpen ? "Hide bottom panel" : "Show bottom panel",
          detail: "Ctrl+`",
          group: "Action",
          action: toggleBottom,
        },
        {
          id: "action-rescan",
          label: "Rescan workspace",
          detail: root,
          group: "Action",
          action: () => void openWorkspace(root),
        },
        {
          id: "action-open-folder",
          label: "Open workspace folder…",
          group: "Action",
          action: () => void pickAndOpen(),
        },
        {
          id: "action-kill-port",
          label: "Kill process on port…",
          group: "Action",
          action: () => setKillPortOpen(true),
        },
        {
          id: "action-check-updates",
          label: "Check for updates",
          detail: `Current version v${__APP_VERSION__}`,
          group: "Action",
          keywords: "upgrade version release",
          action: updater.checkNow,
        },
      ]
    : [];

  if (!root) {
    return (
      <div className="welcome">
        <h1>VibeDeck</h1>
        <p>Git branches, diffs and run configs for local development.</p>
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
        <UpdateNotice updater={updater} runningCount={totalRunning} />
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
          <Menu size={16} />
        </button>
        <span className="app-name">VibeDeck</span>
        <div className="workspace-switcher">
          <button
            className="workspace-name ws-button"
            title={root}
            onClick={() => setSwitcherOpen(!switcherOpen)}
          >
            {workspaceName} <ChevronDown size={12} />
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
                    {r === root ? "" : ""}
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
                  <Folder size={14} />
                  Open folder…
                </button>
                <button
                  className="ws-item"
                  onClick={() => {
                    setSwitcherOpen(false);
                    api.newWindow().catch((e) => showError(String(e)));
                  }}
                >
                  New window
                </button>
              </div>
            </>
          )}
        </div>
        <button className="command-trigger" onClick={() => setPaletteOpen(true)}>
          <span aria-hidden="true">⌕</span>
          <span>Search commands</span>
          <kbd>Ctrl K</kbd>
        </button>
        {totalRunning > 0 && (
          <button
            className="running-indicator running-indicator-btn"
            onClick={() => setBottomOpen(true)}
            title={`Open run output (${totalRunning} running)`}
          >
            <span className="running-dot" /> {totalRunning} running
          </button>
        )}
        <span className="topbar-spacer" />
        <button
          className={`mini-btn ${bottomOpen ? "active-btn" : ""}`}
          onClick={toggleBottom}
          title="Toggle bottom panel (Ctrl+`)"
        >
          <TerminalIcon size={14} /> Terminal
        </button>
        <div className="more-menu">
          <button className={`mini-btn more-button ${moreOpen ? "active-btn" : ""}`} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="More actions">•••</button>
          {moreOpen && (
            <>
              <div className="ws-backdrop" onClick={() => setMoreOpen(false)} />
              <div className="more-dropdown">
                <button onClick={() => { setMoreOpen(false); setKillPortOpen(true); }}>Kill process on port…</button>
                <button onClick={() => { setMoreOpen(false); void pickAndOpen(); }}>Open folder…</button>
                <button onClick={() => { setMoreOpen(false); void api.newWindow().catch((e) => showError(String(e))); }}>New window</button>
                <button onClick={() => { setMoreOpen(false); updater.checkNow(); }}>Check for updates…</button>
                <div className="ws-divider" />
                <div className="app-meta">VibeDeck v{__APP_VERSION__}<small>Built {__BUILD_TIME__}{lastSaved ? ` · saved ${lastSaved}` : ""}</small></div>
              </div>
            </>
          )}
        </div>
      </header>
      {paletteOpen && <CommandPalette items={commandItems} onClose={() => setPaletteOpen(false)} />}
      {killPortOpen && <KillPortModal onClose={() => setKillPortOpen(false)} />}
      <UpdateNotice updater={updater} runningCount={totalRunning} />

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError(null)}>
            <Close size={14} />
          </button>
        </div>
      )}

      <div className="main">
        {sidebarOpen && (
          <>
            <Sidebar
              repos={repos}
              root={root}
              selected={view === "repo" ? selectedRepo : null}
              runningByRepo={runningByRepo}
              onSelect={(path) => {
                setSelectedRepo(path);
                setView("repo");
                setError(null);
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
              onRenameGroup={renameGroup}
              onAddToGroup={addToGroup}
              onRemoveFromGroup={removeFromGroup}
              onMoveInGroup={moveInGroup}
              onSetGroupDelay={setGroupDelay}
              onSetGroupIcon={setGroupIcon}
              onReorderGroups={reorderGroups}
            />
          ) : selectedRepo ? (
            <>
              {(() => {
                const selRepo = repos.find((r) => r.path === selectedRepo);
                if (!selRepo) return null;
                return (
                  <div className="repo-header">
                    <div className="repo-header-main">
                      <span className="repo-header-name">{selRepo.name}</span>
                      <span className="repo-header-branch">{selRepo.branch}</span>
                      {selRepo.changed_files > 0 && (
                        <span className="badge badge-changes" title={`${selRepo.changed_files} changed file(s)`}>
                          {selRepo.changed_files}
                        </span>
                      )}
                      {selRepo.ahead > 0 && <span className="badge badge-ahead" title={`${selRepo.ahead} commit(s) ahead`}>↑{selRepo.ahead}</span>}
                      {selRepo.behind > 0 && <span className="badge badge-behind" title={`${selRepo.behind} commit(s) behind`}>↓{selRepo.behind}</span>}
                    </div>
                  </div>
                );
              })()}
              <nav className="tabs" role="tablist" aria-label="Repository views">
                {(["changes", "branches", "history", "run", "env"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    className={`tab ${tab === t ? "active" : ""}`}
                    onClick={() => setTab(t)}
                    role="tab"
                    aria-selected={tab === t}
                  >
                    {t === "run" && (runningByRepo[selectedRepo] ?? 0) > 0
                      ? `Run (${runningByRepo[selectedRepo]})`
                      : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </nav>
              <div className="tab-content">
                {tab === "changes" && (
                  <ChangesView
                    repoPath={selectedRepo}
                    onError={showError}
                    onSuccess={() => setError(null)}
                    onRepoChanged={refreshSelectedRepo}
                  />
                )}
                {tab === "branches" && (
                  <BranchesView
                    repoPath={selectedRepo}
                    onError={showError}
                    onSuccess={() => setError(null)}
                    onRepoChanged={refreshSelectedRepo}
                  />
                )}
                {tab === "history" && <HistoryView repoPath={selectedRepo} onError={showError} onSuccess={() => setError(null)} />}
                {tab === "env" && <EnvView repoPath={selectedRepo} onError={showError} onSuccess={() => setError(null)} />}
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
            </>
          ) : (
            <div className="welcome-empty">
              <div className="welcome-empty-text">Select a repository to get started</div>
              <div className="welcome-empty-hint">
                Choose a repo from the sidebar, or open <strong>Favorites</strong> to run pinned configs
              </div>
            </div>
          )}
        </section>
      </div>

      <BottomPanel
        open={bottomOpen}
        sessions={sessions}
        repos={repos}
        activeSessionId={activeSessionId}
        onToggle={toggleBottom}
        onSelectSession={setActiveSessionId}
        onRestart={restartRun}
        onStop={stopRun}
        onClear={clearRun}
        onError={showError}
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
