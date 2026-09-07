import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import { useResizable } from "../useResizable";

interface Props {
  repoPath: string;
  onError: (msg: string) => void;
}

export default function EnvView({ repoPath, onError }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState(".env.local");
  const [panelWidth, onPanelResize] = useResizable("vd-env-w", 280, 200, 550);

  const load = useCallback(async () => {
    try {
      const found = await api.listEnvFiles(repoPath);
      setFiles(found);
      setSelected((prev) => (prev && found.includes(prev) ? prev : found[0] ?? null));
    } catch (e) {
      onError(String(e));
    }
  }, [repoPath, onError]);

  useEffect(() => {
    setSelected(null);
    setContent("");
    setSavedContent("");
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setContent("");
      setSavedContent("");
      return;
    }
    api
      .readEnvFile(repoPath, selected)
      .then((text) => {
        setContent(text);
        setSavedContent(text);
      })
      .catch((e) => onError(String(e)));
  }, [selected, repoPath, onError]);

  const dirty = content !== savedContent;

  const save = async () => {
    if (!selected || !dirty) return;
    try {
      await api.writeEnvFile(repoPath, selected, content);
      setSavedContent(content);
    } catch (e) {
      onError(String(e));
    }
  };

  const createFile = async (name: string) => {
    try {
      await api.writeEnvFile(repoPath, name, "");
      await load();
      setSelected(name);
      setShowNew(false);
    } catch (e) {
      onError(String(e));
    }
  };

  const selectFile = async (file: string) => {
    if (dirty && !(await api.confirmAsk(`Discard unsaved changes in ${selected}?`))) return;
    setSelected(file);
  };

  return (
    <div className="env-view">
      <div className="env-list" style={{ width: panelWidth, minWidth: panelWidth }}>
        <div className="section-header">
          <span>Env files ({files.length})</span>
          <button className="mini-btn" onClick={() => setShowNew(!showNew)}>
            {showNew ? "Cancel" : "+ New"}
          </button>
        </div>
        {showNew && (
          <form
            className="add-config-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) createFile(name);
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder=".env.local or apps/web/.env"
            />
            <button className="mini-btn" type="submit">
              Create
            </button>
          </form>
        )}
        <ul className="config-list">
          {files.map((f) => (
            <li
              key={f}
              className={`file-row env-file-row ${selected === f ? "selected" : ""}`}
              onClick={() => selectFile(f)}
            >
              <span className="file-path" title={f}>
                {f}
                {selected === f && dirty ? " •" : ""}
              </span>
            </li>
          ))}
          {files.length === 0 && (
            <li className="config-hint">No .env files found in this repo (searched 2 levels deep).</li>
          )}
        </ul>
        <div className="config-hint env-note">
          Saved straight to disk. These files are usually gitignored — VibeDeck shows values in
          plain text, so mind who's looking over your shoulder.
        </div>
      </div>
      <div className="resizer" onMouseDown={onPanelResize} />

      <div className="env-editor-pane">
        {selected ? (
          <>
            <div className="session-toolbar">
              <span className="session-command">
                {selected}
                {dirty ? "  •  unsaved" : ""}
              </span>
              <span className="session-actions">
                <button className="primary-btn env-save" disabled={!dirty} onClick={save}>
                  Save
                </button>
              </span>
            </div>
            <textarea
              className="env-editor"
              value={content}
              spellCheck={false}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </>
        ) : (
          <div className="diff-empty">Select an env file to view or edit it</div>
        )}
      </div>
    </div>
  );
}
