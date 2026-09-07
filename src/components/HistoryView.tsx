import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { CommitEntry } from "../types";
import DiffView from "./DiffView";
import { useResizable } from "../useResizable";

interface Props {
  repoPath: string;
  onError: (msg: string) => void;
}

export default function HistoryView({ repoPath, onError }: Props) {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [selected, setSelected] = useState<CommitEntry | null>(null);
  const [patch, setPatch] = useState("");
  const [limit, setLimit] = useState(50);
  const [panelWidth, onPanelResize] = useResizable("vd-history-w", 340, 240, 700);

  const refresh = useCallback(async () => {
    try {
      setCommits(await api.commitLog(repoPath, limit));
    } catch (e) {
      onError(String(e));
    }
  }, [repoPath, limit, onError]);

  useEffect(() => {
    setSelected(null);
    setPatch("");
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    api
      .commitDiff(repoPath, selected.sha)
      .then(setPatch)
      .catch((e) => onError(String(e)));
  }, [selected, repoPath, onError]);

  return (
    <div className="history-view">
      <div className="commit-list" style={{ width: panelWidth, minWidth: panelWidth }}>
        {commits.map((c) => (
          <div
            key={c.sha}
            className={`commit-row ${selected?.sha === c.sha ? "selected" : ""}`}
            onClick={() => setSelected(c)}
          >
            <div className="commit-subject">{c.subject}</div>
            <div className="commit-meta">
              <span className="commit-sha">{c.short_sha}</span>
              <span>{c.author}</span>
              <span>{c.date}</span>
            </div>
            {c.refs && <div className="commit-refs">{c.refs}</div>}
          </div>
        ))}
        {commits.length >= limit && (
          <button className="mini-btn load-more" onClick={() => setLimit(limit + 100)}>
            Load more
          </button>
        )}
      </div>
      <div className="resizer" onMouseDown={onPanelResize} />
      <div className="commit-diff">
        <DiffView patch={patch} emptyMessage="Select a commit to see its changes" />
      </div>
    </div>
  );
}
