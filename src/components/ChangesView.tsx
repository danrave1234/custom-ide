import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import { confirmAsk } from "../api";
import type { FileStatus, RepoStatus } from "../types";
import DiffView from "./DiffView";
import { useResizable } from "../useResizable";

interface Props {
  repoPath: string;
  onError: (msg: string) => void;
  onRepoChanged: () => void;
}

interface SelectedFile {
  file: FileStatus;
  staged: boolean;
}

const statusLabel = (code: string) =>
  ({ M: "M", A: "A", D: "D", R: "R", C: "C", U: "U", "?": "U" }[code] ?? code);

export default function ChangesView({ repoPath, onError, onRepoChanged }: Props) {
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelWidth, onPanelResize] = useResizable("vd-changes-w", 320, 240, 700);

  const isUntracked = (f: FileStatus) => f.index_status === "?" && f.worktree_status === "?";
  const staged = (status?.files ?? []).filter((f) => f.index_status !== " " && f.index_status !== "?");
  const unstaged = (status?.files ?? []).filter(
    (f) => f.worktree_status !== " " || isUntracked(f)
  );

  const refresh = useCallback(async () => {
    try {
      const s = await api.repoStatus(repoPath);
      setStatus(s);
    } catch (e) {
      onError(String(e));
    }
  }, [repoPath, onError]);

  useEffect(() => {
    setSelected(null);
    setPatch("");
    setMessage("");
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setPatch("");
      return;
    }
    const { file, staged } = selected;
    api
      .getDiff(repoPath, file.path, staged, isUntracked(file) && !staged)
      .then(setPatch)
      .catch((e) => onError(String(e)));
  }, [selected, repoPath, onError]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      onRepoChanged();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const canCommit = !busy && staged.length > 0 && message.trim().length > 0;
  const doCommit = () =>
    act(async () => {
      await api.commit(repoPath, message.trim());
      setMessage("");
      setSelected(null);
    });

  const fileRow = (file: FileStatus, isStaged: boolean) => {
    const code = isStaged ? file.index_status : isUntracked(file) ? "?" : file.worktree_status;
    const isSelected =
      selected?.file.path === file.path && selected?.staged === isStaged;
    return (
      <li
        key={`${isStaged ? "s" : "u"}-${file.path}`}
        className={`file-row ${isSelected ? "selected" : ""}`}
        onClick={() => setSelected({ file, staged: isStaged })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelected({ file, staged: isStaged });
          }
        }}
        tabIndex={0}
        role="option"
        aria-selected={isSelected}
      >
        <span className={`file-status file-status-${statusLabel(code)}`}>{statusLabel(code)}</span>
        <span className="file-path" title={file.path}>
          {file.orig_path ? `${file.orig_path} → ${file.path}` : file.path}
        </span>
        <span className="file-actions">
          {isStaged ? (
            <button
              className="icon-btn"
              title="Unstage"
              onClick={(e) => { e.stopPropagation(); act(() => api.unstageFile(repoPath, file.path)); }}
            >
              −
            </button>
          ) : (
            <>
              <button
                className="icon-btn"
                title="Stage"
                onClick={(e) => { e.stopPropagation(); act(() => api.stageFile(repoPath, file.path)); }}
              >
                +
              </button>
              <button
                className="icon-btn danger"
                title="Discard changes"
                onClick={async (e) => {
                  e.stopPropagation();
                  const untracked = isUntracked(file);
                  const verb = untracked ? "Delete untracked file" : "Discard changes in";
                  if (await confirmAsk(`${verb} ${file.path}? This cannot be undone.`)) {
                    act(() => api.discardFile(repoPath, file.path, untracked));
                  }
                }}
              >
                ↺
              </button>
            </>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="changes-view">
      <div className="changes-list" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="section-header">
          <span>Staged ({staged.length})</span>
        </div>
        <ul className="file-list">{staged.map((f) => fileRow(f, true))}</ul>

        <div className="section-header">
          <span>Changes ({unstaged.length})</span>
          {unstaged.length > 0 && (
            <button className="mini-btn" disabled={busy} onClick={() => act(() => api.stageAll(repoPath))}>
              Stage all
            </button>
          )}
        </div>
        <ul className="file-list">{unstaged.map((f) => fileRow(f, false))}</ul>

        <div className="commit-box">
          <textarea
            placeholder="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canCommit) {
                e.preventDefault();
                doCommit();
              }
            }}
            rows={3}
            aria-label="Commit message"
          />
          <button
            className="primary-btn"
            disabled={!canCommit}
            onClick={doCommit}
            title="Commit staged files (Ctrl+Enter)"
          >
            Commit {staged.length > 0 ? `${staged.length} file${staged.length > 1 ? "s" : ""}` : ""}
          </button>
        </div>
      </div>
      <div className="resizer" onMouseDown={onPanelResize} />
      <div className="changes-diff">
        <DiffView
          patch={patch}
          emptyMessage={
            (status?.files.length ?? 0) === 0
              ? "Working tree clean ✓"
              : "Select a file to see its diff"
          }
        />
      </div>
    </div>
  );
}
