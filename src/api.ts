import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import type {
  Branches,
  CommitEntry,
  DetectedConfig,
  PersistedState,
  RepoInfo,
  RepoStatus,
  RunGroup,
} from "./types";

export const pickFolder = async (): Promise<string | null> => {
  const result = await open({ directory: true, multiple: false, title: "Open workspace folder" });
  return typeof result === "string" ? result : null;
};

export const scanRepos = (root: string) => invoke<RepoInfo[]>("scan_repos", { root });
export const refreshRepo = (path: string) => invoke<RepoInfo>("refresh_repo", { path });
export const repoStatus = (path: string) => invoke<RepoStatus>("repo_status", { path });
export const listBranches = (path: string) => invoke<Branches>("list_branches", { path });
export const checkoutBranch = (path: string, branch: string) =>
  invoke<string>("checkout_branch", { path, branch });
export const createBranch = (path: string, name: string) =>
  invoke<string>("create_branch", { path, name });
export const deleteBranch = (path: string, name: string, force: boolean) =>
  invoke<string>("delete_branch", { path, name, force });
export const stageFile = (path: string, file: string) => invoke<string>("stage_file", { path, file });
export const unstageFile = (path: string, file: string) =>
  invoke<string>("unstage_file", { path, file });
export const stageAll = (path: string) => invoke<string>("stage_all", { path });
export const discardFile = (path: string, file: string, untracked: boolean) =>
  invoke<string>("discard_file", { path, file, untracked });
export const commit = (path: string, message: string) => invoke<string>("commit", { path, message });
export const getDiff = (path: string, file: string | null, staged: boolean, untracked: boolean) =>
  invoke<string>("get_diff", { path, file, staged, untracked });
export const commitLog = (path: string, limit: number) =>
  invoke<CommitEntry[]>("commit_log", { path, limit });
export const commitDiff = (path: string, sha: string) => invoke<string>("commit_diff", { path, sha });
export const rebaseInProgress = (path: string) => invoke<boolean>("rebase_in_progress", { path });
export const abortRebase = (path: string) => invoke<string>("abort_rebase", { path });
export const gitFetch = (path: string) => invoke<string>("git_fetch", { path });
export const gitPull = (path: string) => invoke<string>("git_pull", { path });
export const gitPush = (path: string) => invoke<string>("git_push", { path });

export const detectRunConfigs = (path: string) =>
  invoke<DetectedConfig[]>("detect_run_configs", { path });
export const startRun = (id: string, cwd: string, command: string) =>
  invoke<number>("start_run", { id, cwd, command });
export const stopRun = (id: string) => invoke<void>("stop_run", { id });
export const listRunning = () => invoke<string[]>("list_running");
export const watchRunChanges = (id: string, path: string) =>
  invoke<void>("watch_run_changes", { id, path });
export const unwatchRunChanges = (id: string) => invoke<void>("unwatch_run_changes", { id });

export const newWindow = () => invoke<void>("new_window");

/** Native yes/no dialog — window.confirm is unreliable inside the webview. */
export const confirmAsk = (message: string) =>
  ask(message, { title: "VibeDeck", kind: "warning" });

export interface PortProcess {
  pid: number;
  name: string;
  addresses: string;
  state: string;
}

export const portLookup = (port: number) => invoke<PortProcess[]>("port_lookup", { port });
export const killPid = (pid: number) => invoke<void>("kill_pid", { pid });

export const ptyOpen = (id: string, cwd: string, rows: number, cols: number) =>
  invoke<void>("pty_open", { id, cwd, rows, cols });
export const ptyInput = (id: string, data: string) => invoke<void>("pty_input", { id, data });
export const ptyResize = (id: string, rows: number, cols: number) =>
  invoke<void>("pty_resize", { id, rows, cols });
export const ptyClose = (id: string) => invoke<void>("pty_close", { id });
export const listEnvFiles = (path: string) => invoke<string[]>("list_env_files", { path });
export const readEnvFile = (path: string, file: string) =>
  invoke<string>("read_env_file", { path, file });
export const writeEnvFile = (path: string, file: string, content: string) =>
  invoke<void>("write_env_file", { path, file, content });

const STATE_KEY = "vibedeck-state";

const EMPTY_STATE: PersistedState = {
  lastRoot: null,
  recentRoots: [],
  customConfigs: {},
  pinnedConfigs: {},
  groupsByRoot: {},
  syncPrefs: {},
};

export const loadPersistedState = async (): Promise<PersistedState> => {
  const raw = await invoke<string | null>("load_blob", { key: STATE_KEY });
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState> & { groups?: RunGroup[] };
    const withDefaults = (groups: RunGroup[]) =>
      groups.map((g) => ({ ...g, delaySeconds: g.delaySeconds ?? 3 }));
    let groupsByRoot = Object.fromEntries(
      Object.entries(parsed.groupsByRoot ?? {}).map(([k, v]) => [k, withDefaults(v)])
    );

    const knownRoots = [
      ...new Set(
        [...(parsed.recentRoots ?? []), parsed.lastRoot, ...Object.keys(groupsByRoot)].filter(
          (r): r is string => !!r
        )
      ),
    ];
    const under = (path: string, root: string) => {
      const p = path.toLowerCase();
      const r = root.toLowerCase();
      return p === r || p.startsWith(r + "\\") || p.startsWith(r + "/");
    };
    // a group belongs to whichever workspace actually contains its configs —
    // longest match wins so nested roots resolve to the most specific one
    const homeFor = (group: RunGroup, fallback: string) => {
      const counts = new Map<string, number>();
      for (const item of group.items ?? []) {
        const match = knownRoots
          .filter((r) => under(item.repoPath ?? "", r))
          .sort((a, b) => b.length - a.length)[0];
        if (match) counts.set(match, (counts.get(match) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return best?.[0] ?? fallback;
    };

    // migrate pre-project-scoping state, and re-home any group that a previous
    // migration filed under the wrong workspace
    const stray: [RunGroup, string][] = [];
    if (parsed.groups?.length && Object.keys(groupsByRoot).length === 0) {
      stray.push(...parsed.groups.map((g) => [g, parsed.lastRoot ?? ""] as [RunGroup, string]));
    }
    for (const [root, groups] of Object.entries(groupsByRoot)) {
      for (const g of groups) stray.push([g, root]);
    }
    if (stray.length) {
      const rehomed: Record<string, RunGroup[]> = {};
      for (const [group, currentRoot] of stray) {
        const home = homeFor(group, currentRoot);
        if (!home) continue;
        (rehomed[home] ??= []).push({ ...group, delaySeconds: group.delaySeconds ?? 3 });
      }
      groupsByRoot = rehomed;
    }
    return {
      lastRoot: parsed.lastRoot ?? null,
      recentRoots: parsed.recentRoots ?? [],
      customConfigs: parsed.customConfigs ?? {},
      pinnedConfigs: parsed.pinnedConfigs ?? {},
      groupsByRoot,
      syncPrefs: parsed.syncPrefs ?? {},
    };
  } catch {
    return EMPTY_STATE;
  }
};

export const savePersistedState = (state: PersistedState) =>
  invoke<void>("save_blob", { key: STATE_KEY, value: JSON.stringify(state, null, 2) });

/** Records which build actually launched — makes "am I running the new version?"
 * answerable from disk instead of by eye. */
export const recordBuildInfo = (build: string) =>
  invoke<void>("save_blob", {
    key: "buildinfo",
    value: JSON.stringify({ build, launchedAt: new Date().toISOString() }, null, 2),
  }).catch(() => {});
