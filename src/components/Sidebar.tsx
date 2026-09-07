import { useMemo, useState } from "react";
import type { RepoInfo } from "../types";

interface Props {
  repos: RepoInfo[];
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

export default function Sidebar({
  repos,
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
  const totalRunning = Object.values(runningByRepo).reduce((a, b) => a + b, 0);
  const visibleRepos = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = repos.filter((repo) =>
      `${repo.name} ${repo.path} ${repo.branch}`.toLowerCase().includes(needle)
    );
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const activityA = (runningByRepo[a.path] ?? 0) * 1000 + a.changed_files * 10 + a.ahead + a.behind;
      const activityB = (runningByRepo[b.path] ?? 0) * 1000 + b.changed_files * 10 + b.ahead + b.behind;
      return activityB - activityA || a.name.localeCompare(b.name);
    });
  }, [query, repos, runningByRepo, sort]);
  return (
    <aside className="sidebar" style={{ width, minWidth: width }} aria-label="Workspace navigation">
      <button
        type="button"
        className={`repo-item favorites-item ${favoritesSelected ? "selected" : ""}`}
        onClick={onSelectFavorites}
        aria-current={favoritesSelected ? "page" : undefined}
      >
        <div className="repo-name-row">
          <span className="repo-name">★ Favorites</span>
          {totalRunning > 0 && <span className="running-dot" title={`${totalRunning} running`} />}
        </div>
        <div className="repo-meta">
          <span>{favoritesCount} pinned</span>
        </div>
      </button>
      <button
        type="button"
        className={`repo-item favorites-item sync-item ${syncSelected ? "selected" : ""}`}
        onClick={onSelectSync}
        aria-current={syncSelected ? "page" : undefined}
      >
        <div className="repo-name-row">
          <span className="repo-name sync-name">⇅ Sync repos</span>
        </div>
        <div className="repo-meta">
          <span>fetch · rebase · push</span>
        </div>
      </button>
      <div className="sidebar-header">
        <span>Repositories</span>
        <button className="icon-btn" title="Rescan workspace" onClick={onRefresh} disabled={loading}>
          {loading ? "…" : "⟳"}
        </button>
      </div>
      <div className="sidebar-tools">
        <div className="sidebar-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter repositories…"
            aria-label="Filter repositories"
          />
          {query && <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear repository filter">×</button>}
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as "name" | "activity")} aria-label="Sort repositories">
          <option value="activity">Active first</option>
          <option value="name">Name</option>
        </select>
      </div>
      {repos.length === 0 && !loading && (
        <div className="sidebar-empty">No git repositories found in this folder.</div>
      )}
      {repos.length > 0 && visibleRepos.length === 0 && (
        <div className="sidebar-empty">No repositories match “{query}”.</div>
      )}
      <ul className="repo-list" aria-label="Repositories">
        {visibleRepos.map((repo) => (
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
              <span className="repo-branch">⎇ {repo.branch}</span>
              {repo.changed_files > 0 && (
                <span className="badge badge-changes" title={`${repo.changed_files} changed file(s)`}>{repo.changed_files}</span>
              )}
              {repo.ahead > 0 && <span className="badge badge-ahead" title={`${repo.ahead} commit(s) ahead`}>↑{repo.ahead}</span>}
              {repo.behind > 0 && <span className="badge badge-behind" title={`${repo.behind} commit(s) behind`}>↓{repo.behind}</span>}
            </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
