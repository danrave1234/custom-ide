import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import { confirmAsk } from "../api";
import type { Branches } from "../types";

interface Props {
  repoPath: string;
  onError: (msg: string) => void;
  onRepoChanged: () => void;
}

export default function BranchesView({ repoPath, onError, onRepoChanged }: Props) {
  const [branches, setBranches] = useState<Branches | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [showRemotes, setShowRemotes] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBranches(await api.listBranches(repoPath));
    } catch (e) {
      onError(String(e));
    }
  }, [repoPath, onError]);

  useEffect(() => {
    setSyncMsg("");
    setNewBranch("");
    refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, doneMsg?: string) => {
    setBusy(true);
    setSyncMsg("");
    try {
      const out = await fn();
      await refresh();
      onRepoChanged();
      if (doneMsg) setSyncMsg(typeof out === "string" && out.trim() ? out.trim() : doneMsg);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const checkout = (name: string) => act(() => api.checkoutBranch(repoPath, name));

  return (
    <div className="branches-view">
      <div className="branches-toolbar">
        <form
          className="new-branch-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newBranch.trim()) return;
            act(() => api.createBranch(repoPath, newBranch.trim()));
            setNewBranch("");
          }}
        >
          <input
            placeholder="new-branch-name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
          />
          <button className="mini-btn" disabled={busy || !newBranch.trim()} type="submit">
            + Create & switch
          </button>
        </form>
        <div className="sync-buttons">
          <button className="mini-btn" disabled={busy} onClick={() => act(() => api.gitFetch(repoPath), "Fetched.")}>
            Fetch
          </button>
          <button className="mini-btn" disabled={busy} onClick={() => act(() => api.gitPull(repoPath), "Pulled.")}>
            Pull
          </button>
          <button className="mini-btn" disabled={busy} onClick={() => act(() => api.gitPush(repoPath), "Pushed.")}>
            Push
          </button>
        </div>
      </div>
      {syncMsg && <pre className="sync-output">{syncMsg}</pre>}

      <ul className="branch-list">
        {(branches?.locals ?? []).map((b) => (
          <li key={b.name} className={`branch-row ${b.is_current ? "current" : ""}`}>
            <div className="branch-main">
              <span className="branch-name">
                {b.is_current ? "● " : ""}
                {b.name}
              </span>
              {b.upstream && <span className="branch-upstream">→ {b.upstream}</span>}
              <span className="branch-subject" title={b.last_subject}>
                {b.last_subject}
              </span>
              <span className="branch-date">{b.last_date}</span>
            </div>
            <div className="branch-actions">
              {!b.is_current && (
                <>
                  <button className="mini-btn" disabled={busy} onClick={() => checkout(b.name)}>
                    Switch
                  </button>
                  <button
                    className="mini-btn danger"
                    disabled={busy}
                    onClick={async () => {
                      if (await confirmAsk(`Delete branch ${b.name}?`)) {
                        act(() => api.deleteBranch(repoPath, b.name, false));
                      }
                    }}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="section-header remotes-toggle" onClick={() => setShowRemotes(!showRemotes)}>
        <span>
          {showRemotes ? "▾" : "▸"} Remote branches ({branches?.remotes.length ?? 0})
        </span>
      </div>
      {showRemotes && (
        <ul className="branch-list remotes">
          {(branches?.remotes ?? []).map((r) => (
            <li key={r} className="branch-row remote">
              <span className="branch-name">{r}</span>
              <button
                className="mini-btn"
                disabled={busy}
                onClick={() => checkout(r.replace(/^[^/]+\//, ""))}
                title="Checkout a local branch tracking this remote"
              >
                Checkout
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
