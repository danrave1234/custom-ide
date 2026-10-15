import { useMemo, useState } from "react";
import type { RepoInfo } from "../types";
import { Star, Sync, Refresh, Search, Close, Folder, ChevronRight, ChevronDown } from "./Icons";

interface Props {
  repos: RepoInfo[];
  root: string | null;
  selected: string | null;
  runningByRepo: Record<string, number>;
  onSelect: (path: string) => void;
  onRefresh: () => void;
  loading: boolean;
  favoritesCount: number;
  favoritesSelected: boolean;
  onSelectFavorites: () => void;
  syncSelected: boolean;
  onSelectSync: () => void;
  width: number;
}

/** Compute a folder key from a repo path relative to a workspace root.
 *  Returns the first path segment after root, or `null` if the repo is
 *  directly under root or root is not set. */
function folderKey(repoPath: string, root: string | null): string | null {
  if (!root) return null;
  // Normalize both paths: ensure trailing separator for root
  const normalizedRoot = root.replace(/[\\/]+$/, "") + "/";
  const rel = repoPath.replace(normalizedRoot, "");
  // If rel starts with a segment followed by a separator, that's the folder
  const segments = rel.split(/[\\/]/).filter(Boolean);
  // segments[0] is the repo name; if there's a segment before it, that's the folder
  // e.g., "backends/api-server" → segments = ["backends", "api-server"] → folder = "backends"
  // e.g., "api-server" → segments = ["api-server"] → no folder
  // We need the parent directory of the repo within the workspace
  // repoPath is the full path, so rel is like "backends/api-server" or "api-server"
  // The folder is everything except the last segment
  if (segments.length <= 1) return null;
  return segments.slice(0, -1).join("/");
}

export default function Sidebar({
  repos,
  root,
  selected,
  runningByRepo,
  onSelect,
  onRefresh,
  loading,
  favoritesCount,
  favoritesSelected,
  onSelectFavorites,
  syncSelected,
  onSelectSync,
  width,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "activity">("activity");
  const [filter, setFilter] = useState<"all" | "dirty" | "running">("all");
  // Persisted folder collapse state
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("vd-sidebar-folders") ?? "[]"));
    } catch {
      return new Set();
    }
  });

  const setCollapsedFoldersPersist = (updater: (prev: Set<string>) => Set<string>) => {
    setCollapsedFolders((prev) => {
      const next = updater(prev);
      localStorage.setItem("vd-sidebar-folders", JSON.stringify([...next]));
      return next;
    });
  };

  const toggleFolder = (key: string) => {
    setCollapsedFoldersPersist((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalRunning = Object.values(runningByRepo).reduce((a, b) => a + b, 0);

  // Filter repos by query and filter chip
  const filteredRepos = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return repos.filter((repo) => {
      const matchesQuery = !needle || `${repo.name} ${repo.path} ${repo.branch}`.toLowerCase().includes(needle);
      const matchesFilter =
        filter === "all" ||
        (filter === "dirty" && repo.changed_files > 0) ||
        (filter === "running" && (runningByRepo[repo.path] ?? 0) > 0);
      return matchesQuery && matchesFilter;
    });
  }, [query, repos, filter, runningByRepo]);

  // Group repos by folder key
  const groupedRepos = useMemo(() => {
    const folders = new Map<string, RepoInfo[]>();
    const ungrouped: RepoInfo[] = [];

    for (const repo of filteredRepos) {
      const key = folderKey(repo.path, root);
      if (key) {
        const list = folders.get(key) ?? [];
        list.push(repo);
        folders.set(key, list);
      } else {
        ungrouped.push(repo);
      }
    }

    // Sort repos within each group
    const sortFn = (a: RepoInfo, b: RepoInfo) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const activityA = (runningByRepo[a.path] ?? 0) * 1000 + a.changed_files * 10 + a.ahead + a.behind;
      const activityB = (runningByRepo[b.path] ?? 0) * 1000 + b.changed_files * 10 + b.ahead + b.behind;
      return activityB - activityA || a.name.localeCompare(b.name);
    };

    for (const list of folders.values()) {
      list.sort(sortFn);
    }
    ungrouped.sort(sortFn);

    // Sort folder keys alphabetically
    const sortedKeys = [...folders.keys()].sort((a, b) => a.localeCompare(b));

    return { folders, folderKeys: sortedKeys, ungrouped };
  }, [filteredRepos, root, sort, runningByRepo]);

  // Only show folder grouping if we have 2+ folders or any folder with repos
  const showFolders = groupedRepos.folderKeys.length >= 1 && root !== null;

  const renderRepoItem = (repo: RepoInfo) => (
    <li
      key={repo.path}
      className={`repo-item ${selected === repo.path ? "selected" : ""}`}
    >
      <button
        type="button"
        className="repo-button"
        onClick={() => onSelect(repo.path)}
        aria-current={selected === repo.path ? "page" : undefined}
        title={repo.path}
      >
        <div className="repo-name-row">
          <span className="repo-name">{repo.name}</span>
          {(runningByRepo[repo.path] ?? 0) > 0 && (
            <span className="running-dot" title={`${runningByRepo[repo.path]} process(es) running`} />
          )}
        </div>
        <div className="repo-meta">
          <span className="repo-branch">{repo.branch}</span>
          {repo.changed_files > 0 && (
            <span className="badge badge-changes" title={`${repo.changed_files} changed file(s)`}>{repo.changed_files}</span>
          )}
          {repo.ahead > 0 && <span className="badge badge-ahead" title={`${repo.ahead} commit(s) ahead`}>↑{repo.ahead}</span>}
          {repo.behind > 0 && <span className="badge badge-behind" title={`${repo.behind} commit(s) behind`}>↓{repo.behind}</span>}
        </div>
      </button>
    </li>
  );

  return (
    <aside className="sidebar" style={{ width, minWidth: width }} aria-label="Workspace navigation">
      {/* Workspace nav */}
      <nav className="sidebar-nav" aria-label="Workspace navigation">
        <button
          type="button"
          className={`nav-item ${favoritesSelected ? "selected" : ""}`}
          onClick={onSelectFavorites}
          aria-current={favoritesSelected ? "page" : undefined}
        >
          <span className="nav-icon"><Star size={14} /></span>
          <span className="nav-label">Favorites</span>
          {favoritesCount > 0 && <span className="nav-count">{favoritesCount}</span>}
          {totalRunning > 0 && <span className="running-dot" title={`${totalRunning} running`} />}
        </button>
        <button
          type="button"
          className={`nav-item ${syncSelected ? "selected" : ""}`}
          onClick={onSelectSync}
          aria-current={syncSelected ? "page" : undefined}
        >
          <span className="nav-icon"><Sync size={14} /></span>
          <span className="nav-label">Sync repos</span>
        </button>
      </nav>

      {/* Repositories section */}
      <div className="sidebar-header">
        <span>Repositories</span>
        <button className="icon-btn" title="Rescan workspace" onClick={onRefresh} disabled={loading}>
          <Refresh size={14} />
        </button>
      </div>
      <div className="sidebar-tools">
        <div className="sidebar-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter repositories…"
            aria-label="Filter repositories"
          />
          {query && <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear repository filter"><Close size={12} /></button>}
        </div>
        <div className="sidebar-controls">
          <div className="filter-chips" role="group" aria-label="Filter repositories">
            {(["all", "dirty", "running"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`filter-chip ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
                title={f === "all" ? "Show all" : f === "dirty" ? "Show repos with changes" : "Show repos with running processes"}
              >
                {f === "all" ? "All" : f === "dirty" ? "Dirty" : "Running"}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value as "name" | "activity")} aria-label="Sort repositories">
            <option value="activity">Active first</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      {repos.length === 0 && !loading && (
        <div className="sidebar-empty">No git repositories found in this folder.</div>
      )}
      {repos.length > 0 && filteredRepos.length === 0 && (
        <div className="sidebar-empty">No repositories match the current filter.</div>
      )}

      {/* Repo list with optional folder grouping */}
      {showFolders ? (
        <div className="repo-list-grouped" aria-label="Repositories">
          {groupedRepos.folderKeys.map((key) => {
            const isCollapsed = collapsedFolders.has(key);
            const reposInFolder = groupedRepos.folders.get(key) ?? [];
            return (
              <div key={key} className="repo-folder">
                <button
                  type="button"
                  className="folder-header"
                  onClick={() => toggleFolder(key)}
                  title={`${reposInFolder.length} repo(s) in ${key}`}
                >
                  <span className="folder-arrow">{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
                  <span className="folder-icon"><Folder size={14} /></span>
                  <span className="folder-name">{key}</span>
                  <span className="folder-count">{reposInFolder.length}</span>
                </button>
                {!isCollapsed && (
                  <ul className="repo-list folder-list">
                    {reposInFolder.map(renderRepoItem)}
                  </ul>
                )}
              </div>
            );
          })}
          {groupedRepos.ungrouped.length > 0 && (
            <ul className="repo-list">
              {groupedRepos.ungrouped.map(renderRepoItem)}
            </ul>
          )}
        </div>
      ) : (
        <ul className="repo-list" aria-label="Repositories">
          {filteredRepos.map(renderRepoItem)}
        </ul>
      )}
    </aside>
  );
}
