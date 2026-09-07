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
  const totalRunning = Object.values(runningByRepo).reduce((a, b) => a + b, 0);
  return (
    <aside className="sidebar" style={{ width, minWidth: width }}>
      <div
        className={`repo-item favorites-item ${favoritesSelected ? "selected" : ""}`}
        onClick={onSelectFavorites}
      >
        <div className="repo-name-row">
          <span className="repo-name">★ Favorites</span>
          {totalRunning > 0 && <span className="running-dot" title={`${totalRunning} running`} />}
        </div>
        <div className="repo-meta">
          <span>{favoritesCount} pinned</span>
        </div>
      </div>
      <div
        className={`repo-item favorites-item sync-item ${syncSelected ? "selected" : ""}`}
        onClick={onSelectSync}
      >
        <div className="repo-name-row">
          <span className="repo-name sync-name">⇅ Sync repos</span>
        </div>
        <div className="repo-meta">
          <span>fetch · rebase · push</span>
        </div>
      </div>
      <div className="sidebar-header">
        <span>Repositories</span>
        <button className="icon-btn" title="Rescan workspace" onClick={onRefresh} disabled={loading}>
          {loading ? "…" : "⟳"}
        </button>
      </div>
      {repos.length === 0 && !loading && (
        <div className="sidebar-empty">No git repositories found in this folder.</div>
      )}
      <ul className="repo-list">
        {repos.map((repo) => (
          <li
            key={repo.path}
            className={`repo-item ${selected === repo.path ? "selected" : ""}`}
            onClick={() => onSelect(repo.path)}
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
                <span className="badge badge-changes">{repo.changed_files}</span>
              )}
              {repo.ahead > 0 && <span className="badge badge-ahead">↑{repo.ahead}</span>}
              {repo.behind > 0 && <span className="badge badge-behind">↓{repo.behind}</span>}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
