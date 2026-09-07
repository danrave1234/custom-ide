export interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  changed_files: number;
  ahead: number;
  behind: number;
}

export interface FileStatus {
  path: string;
  orig_path: string | null;
  index_status: string;
  worktree_status: string;
}

export interface RepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: FileStatus[];
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
  upstream: string | null;
  last_subject: string;
  last_date: string;
}

export interface Branches {
  current: string;
  locals: BranchInfo[];
  remotes: string[];
}

export interface CommitEntry {
  sha: string;
  short_sha: string;
  subject: string;
  author: string;
  date: string;
  refs: string;
}

export interface DetectedConfig {
  name: string;
  command: string;
  cwd: string;
  source: string;
}

export interface CustomConfig {
  name: string;
  command: string;
  cwd: string;
}

export interface RunOutputBatchEvent {
  id: string;
  lines: { line: string; stream: "stdout" | "stderr" }[];
}

export interface RunExitEvent {
  id: string;
  code: number | null;
}

export interface RunChangeEvent {
  ids: string[];
}

export type RunStatus = "running" | "exited" | "failed";

export interface RunSession {
  id: string;
  name: string;
  command: string;
  cwd: string;
  repoPath: string;
  status: RunStatus;
  autoRestart: boolean;
  exitCode: number | null;
  lines: OutputLine[];
}

export interface OutputLine {
  text: string;
  stream: "stdout" | "stderr" | "system";
}

export interface GroupItem extends CustomConfig {
  repoPath: string;
}

export interface RunGroup {
  name: string;
  icon?: string;
  items: GroupItem[]; // startup order = list order
  delaySeconds: number; // wait between sequential starts
}

export interface SyncPrefs {
  branch: string;
  selected: string[]; // repo paths to include
  autostash: boolean;
  runBuild: boolean;
  buildCommand: string;
  push: boolean;
}

export interface PersistedState {
  lastRoot: string | null;
  recentRoots: string[];
  customConfigs: Record<string, CustomConfig[]>; // keyed by repo path
  pinnedConfigs: Record<string, CustomConfig[]>; // keyed by repo path
  groupsByRoot: Record<string, RunGroup[]>; // keyed by workspace root
  syncPrefs: Record<string, SyncPrefs>; // keyed by workspace root
}
