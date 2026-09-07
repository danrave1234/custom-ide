import { useEffect, useState } from "react";
import * as api from "../api";
import type { RepoInfo, RunSession, SyncPrefs } from "../types";
import OutputPane from "./OutputPane";
import CopyButton from "./CopyButton";
import { useResizable } from "../useResizable";

// shared branches your team says must never be force-pushed
const PROTECTED_BRANCHES = [
  "main", "master", "dev-release", "uat-release", "develop", "release", "staging", "production",
];

interface Props {
  repos: RepoInfo[];
  prefs: SyncPrefs;
  sessions: RunSession[]; // all sessions; sync ones are filtered here
  activeSessionId: string | null;
  onSavePrefs: (prefs: SyncPrefs) => void;
  onStart: (repoPath: string, name: string, command: string, cwd: string) => void;
  onStop: (id: string) => void;
  onClear: (id: string) => void;
  onSelectSession: (id: string) => void;
  onError: (msg: string) => void;
}

export default function SyncView({
  repos,
  prefs,
  sessions,
  activeSessionId,
  onSavePrefs,
  onStart,
  onStop,
  onClear,
  onSelectSession,
  onError,
}: Props) {
  const [panelWidth, onPanelResize] = useResizable("vd-sync-w", 430, 280, 800);
  const [rebasing, setRebasing] = useState<Record<string, boolean>>({});

  const syncSessions = sessions.filter((s) => s.name === "sync");
  const runningIds = new Set(syncSessions.filter((s) => s.status === "running").map((s) => s.id));
  const idFor = (repoPath: string) => `${repoPath}::sync`;

  // a finished (especially failed) sync may have left a repo mid-rebase
  const finishedCount = syncSessions.filter((s) => s.status !== "running").length;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: Record<string, boolean> = {};
      for (const repo of repos) {
        result[repo.path] = await api.rebaseInProgress(repo.path).catch(() => false);
      }
      if (!cancelled) setRebasing(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, finishedCount]);

  const doAbortRebase = async (repoPath: string) => {
    try {
      await api.abortRebase(repoPath);
      setRebasing((prev) => ({ ...prev, [repoPath]: false }));
    } catch (e) {
      onError(String(e));
    }
  };

  const selectedSet = new Set(prefs.selected);
  const selectedRepos = repos.filter((r) => selectedSet.has(r.path));
  const branch = prefs.branch.trim();

  const isProtected = (b: string) => PROTECTED_BRANCHES.includes(b.toLowerCase());

  const toggleRepo = (path: string) => {
    onSavePrefs({
      ...prefs,
      selected: selectedSet.has(path)
        ? prefs.selected.filter((p) => p !== path)
        : [...prefs.selected, path],
    });
  };

  const commandFor = (repo: RepoInfo) => {
    const steps = [
      "git fetch origin",
      `git rebase${prefs.autostash ? " --autostash" : ""} origin/${branch}`,
    ];
    if (prefs.runBuild && prefs.buildCommand.trim()) {
      steps.push(prefs.buildCommand.trim());
    }
    if (prefs.push) {
      if (isProtected(repo.branch)) {
        steps.push(`echo [vibedeck] push skipped: "${repo.branch}" is a protected branch`);
      } else {
        steps.push("git push --force-with-lease");
      }
    }
    return steps.join(" && ");
  };

  const runSync = async () => {
    const toRun = selectedRepos.filter((r) => !runningIds.has(idFor(r.path)));
    if (toRun.length === 0 || !branch) return;

    const pushable = prefs.push ? toRun.filter((r) => !isProtected(r.branch)) : [];
    const skipped = prefs.push ? toRun.filter((r) => isProtected(r.branch)) : [];
    const lines = [
      `Update ${toRun.length} repo(s) onto origin/${branch}:`,
      ...toRun.map((r) => `  • ${r.name} (on ${r.branch})`),
      "",
      `Steps: fetch → rebase${prefs.autostash ? " (autostash)" : ""}${
        prefs.runBuild && prefs.buildCommand.trim() ? ` → ${prefs.buildCommand.trim()}` : ""
      }${prefs.push ? " → push --force-with-lease" : ""}`,
    ];
    if (skipped.length > 0) {
      lines.push("", `Push will be SKIPPED for protected branches: ${skipped.map((r) => `${r.name} (${r.branch})`).join(", ")}`);
    }
    if (pushable.length > 0) {
      lines.push("", `⚠ Force-push (with lease) will run on: ${pushable.map((r) => `${r.name} (${r.branch})`).join(", ")}`);
    }
    lines.push("", "Continue?");
    if (!(await api.confirmAsk(lines.join("\n")))) return;

    for (const repo of toRun) {
      onStart(repo.path, "sync", commandFor(repo), repo.path);
    }
  };

  const active =
    syncSessions.find((s) => s.id === activeSessionId) ?? syncSessions[0] ?? null;
  const repoLabel = (path: string) =>
    repos.find((r) => r.path === path)?.name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path;

  const runningCount = runningIds.size;

  return (
    <div className="run-view">
      <div className="run-configs" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="favorites-header">
          <span className="favorites-title">⇅ Sync repos</span>
          <button
            className="mini-btn run"
            disabled={selectedRepos.length === 0 || !branch || runningCount > 0}
            onClick={runSync}
          >
            {runningCount > 0 ? `⏳ Syncing (${runningCount})…` : `▶ Update ${selectedRepos.length || ""} repo(s)`}
          </button>
        </div>

        <div className="sync-form">
          <label className="sync-field">
            <span>Rebase onto</span>
            <div className="branch-input-row">
              <span className="branch-origin">origin/</span>
              <input
                value={prefs.branch}
                placeholder="dev-release"
                onChange={(e) => onSavePrefs({ ...prefs, branch: e.target.value })}
              />
            </div>
          </label>

          <label className="sync-toggle">
            <input
              type="checkbox"
              checked={prefs.autostash}
              onChange={(e) => onSavePrefs({ ...prefs, autostash: e.target.checked })}
            />
            Autostash local changes (stash before rebase, pop after)
          </label>

          <label className="sync-toggle">
            <input
              type="checkbox"
              checked={prefs.runBuild}
              onChange={(e) => onSavePrefs({ ...prefs, runBuild: e.target.checked })}
            />
            Run command after rebase
          </label>
          {prefs.runBuild && (
            <input
              className="sync-build-input"
              value={prefs.buildCommand}
              placeholder="pnpm run build"
              onChange={(e) => onSavePrefs({ ...prefs, buildCommand: e.target.value })}
            />
          )}

          <label className="sync-toggle">
            <input
              type="checkbox"
              checked={prefs.push}
              onChange={(e) => onSavePrefs({ ...prefs, push: e.target.checked })}
            />
            Push with <code>--force-with-lease</code> after
          </label>
          {prefs.push && (
            <div className="config-hint">
              Auto-skipped on protected branches ({PROTECTED_BRANCHES.join(", ")}).
            </div>
          )}
        </div>

        <div className="section-header">
          <span>Repositories ({selectedRepos.length}/{repos.length})</span>
          <span className="group-actions">
            <button
              className="mini-btn"
              onClick={() => onSavePrefs({ ...prefs, selected: repos.map((r) => r.path) })}
            >
              All
            </button>
            <button className="mini-btn" onClick={() => onSavePrefs({ ...prefs, selected: [] })}>
              None
            </button>
          </span>
        </div>
        <ul className="config-list">
          {repos.map((r) => {
            const id = idFor(r.path);
            const session = syncSessions.find((s) => s.id === id);
            const isRunning = runningIds.has(id);
            return (
              <li className="config-row sync-repo-row" key={r.path}>
                <label className="sync-repo-label">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(r.path)}
                    onChange={() => toggleRepo(r.path)}
                  />
                  <div className="config-info">
                    <span className="config-name">
                      {r.name}
                      {isProtected(r.branch) && prefs.push && (
                        <span className="badge badge-behind" title="Push will be skipped">no push</span>
                      )}
                    </span>
                    <span className="config-command">
                      ⎇ {r.branch}
                      {r.behind > 0 ? ` · ↓${r.behind} behind` : ""}
                      {r.ahead > 0 ? ` · ↑${r.ahead} ahead` : ""}
                    </span>
                  </div>
                </label>
                <div className="config-actions">
                  {!isRunning && rebasing[r.path] && (
                    <button
                      className="mini-btn danger"
                      title="git rebase --abort — return the repo to its pre-rebase state"
                      onClick={async () => {
                        if (await api.confirmAsk(`Abort the in-progress rebase in ${r.name}? Local commits return to their pre-rebase state.`)) {
                          doAbortRebase(r.path);
                        }
                      }}
                    >
                      ⟲ Abort rebase
                    </button>
                  )}
                  {isRunning ? (
                    <button className="mini-btn danger" onClick={() => onStop(id)}>
                      ■
                    </button>
                  ) : session ? (
                    <span
                      className={`badge ${session.exitCode === 0 ? "badge-ahead" : "badge-del"}`}
                      title={session.exitCode === 0 ? "Synced OK" : `Failed (exit ${session.exitCode})`}
                    >
                      {session.exitCode === 0 ? "✓" : "✗"}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="resizer" onMouseDown={onPanelResize} />

      <div className="run-output">
        <div className="session-tabs">
          {syncSessions.map((s) => (
            <button
              key={s.id}
              className={`session-tab ${active?.id === s.id ? "active" : ""} status-${s.status}`}
              onClick={() => onSelectSession(s.id)}
            >
              <span className={`status-dot status-${s.status}`} />
              {repoLabel(s.repoPath)}
              {s.status === "exited" && s.exitCode !== null && s.exitCode !== 0 && ` (${s.exitCode})`}
            </button>
          ))}
          {syncSessions.length === 0 && (
            <span className="config-hint">
              Pick repos, choose the base branch, hit Update — each repo's progress streams here.
            </span>
          )}
        </div>
        {active && (
          <>
            <div className="session-toolbar">
              <span className="session-command">{active.command}</span>
              <span className="session-actions">
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
