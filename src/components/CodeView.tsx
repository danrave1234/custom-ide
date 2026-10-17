import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import { highlightToLines } from "../highlight";
import { changeMarks, containingRoot, fuzzyScore, type LineMark } from "../codeLines";
import { ChevronDown, ChevronRight, Close, Copy, FileIcon, Folder, Refresh, Search } from "./Icons";
import { useResizable } from "../useResizable";

export interface CodeRoot {
  label: string;
  path: string;
  isRepo: boolean;
}

/** Ask the view to open an absolute file path, optionally at a line. */
export interface OpenFileRequest {
  nonce: number;
  path: string;
  line?: number;
}

interface Props {
  roots: CodeRoot[];
  initialRoot: string;
  explorerOpen: boolean;
  /** false while the Dashboard is shown; the view stays mounted to keep its tabs */
  visible: boolean;
  openRequest: OpenFileRequest | null;
  onError: (msg: string) => void;
}

interface Tab {
  root: string;
  rel: string;
}

interface LoadedFile extends api.FileContent {
  raw: string[];
  html: string[];
  language: string | null;
  marks: Map<number, LineMark>;
}

const LINE_HEIGHT = 20;
/** Open files are re-read this often so edits made by agents show up live. */
const POLL_MS = 2000;
const POLL_MAX_SIZE = 512 * 1024;

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const tabKey = (t: Tab) => `${t.root}::${t.rel}`;
const baseName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
const parentDirs = (rel: string) => {
  const parts = rel.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Git porcelain status letter for display: M, A, D, R, U (untracked). */
function statusLetter(f: { index_status: string; worktree_status: string }) {
  if (f.index_status === "?") return "U";
  const s = f.worktree_status.trim() || f.index_status.trim();
  return s || "M";
}

export default function CodeView({ roots, initialRoot, explorerOpen, visible, openRequest, onError }: Props) {
  const [root, setRoot] = useState(initialRoot);
  const [explorerWidth, onExplorerResize] = useResizable("vd-explorer-w", 260, 180, 520);
  const [children, setChildren] = useState<Record<string, api.DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [gitStatus, setGitStatus] = useState<Map<string, string>>(new Map());
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, LoadedFile>>({});
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [bar, setBar] = useState<null | "find" | "goto">(null);
  const [barQuery, setBarQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const barInputRef = useRef<HTMLInputElement>(null);
  const pendingLine = useRef<number | null>(null);
  /** a file opened in another root, to reveal once that root's tree is loaded */
  const pendingReveal = useRef<Tab | null>(null);

  const rootInfo = roots.find((r) => r.path === root);
  const activeTab = tabs.find((t) => tabKey(t) === activeKey) ?? null;
  const active = activeKey ? files[activeKey] : undefined;

  // ── explorer ──
  const loadDir = useCallback(
    async (rel: string, forRoot = root) => {
      try {
        const entries = await api.listDir(forRoot, rel);
        setChildren((prev) => ({ ...prev, [rel]: entries }));
      } catch (e) {
        onError(String(e));
      }
    },
    [root, onError]
  );

  const loadGitStatus = useCallback(async () => {
    if (!rootInfo?.isRepo) return setGitStatus(new Map());
    try {
      const status = await api.repoStatus(root);
      const map = new Map<string, string>();
      for (const f of status.files) {
        const letter = statusLetter(f);
        map.set(f.path.replace(/\/$/, ""), letter);
        for (const dir of parentDirs(f.path)) if (!map.has(dir)) map.set(dir, "•");
      }
      setGitStatus(map);
    } catch {
      setGitStatus(new Map());
    }
  }, [root, rootInfo?.isRepo]);

  useEffect(() => {
    setChildren({});
    const reveal = pendingReveal.current?.root === root ? parentDirs(pendingReveal.current.rel) : [];
    pendingReveal.current = null;
    setExpanded(new Set(reveal));
    void loadDir("", root);
    reveal.forEach((d) => void loadDir(d, root));
    void loadGitStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // a different workspace was opened: browse it, and drop tabs from the old one
  useEffect(() => {
    if (!roots.length) return;
    const known = new Set(roots.map((r) => r.path));
    if (!known.has(root)) setRoot(known.has(initialRoot) ? initialRoot : roots[0].path);
    setTabs((prev) => {
      const next = prev.filter((t) => known.has(t.root));
      if (next.length === prev.length) return prev;
      setActiveKey((cur) => (next.some((t) => tabKey(t) === cur) ? cur : next.length ? tabKey(next[next.length - 1]) : null));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);

  const refreshExplorer = useCallback(() => {
    void loadDir("");
    expanded.forEach((rel) => void loadDir(rel));
    void loadGitStatus();
  }, [expanded, loadDir, loadGitStatus]);

  // agents change files behind our back; catch up whenever the window regains focus
  useEffect(() => {
    if (!visible) return;
    window.addEventListener("focus", refreshExplorer);
    return () => window.removeEventListener("focus", refreshExplorer);
  }, [visible, refreshExplorer]);

  // and when coming back from the Dashboard
  useEffect(() => {
    if (visible) refreshExplorer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggleDir = (rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else {
        next.add(rel);
        if (!children[rel]) void loadDir(rel);
      }
      return next;
    });
  };

  // ── files ──
  const loadFile = useCallback(
    async (tab: Tab, quiet = false) => {
      const key = tabKey(tab);
      try {
        const content = await api.readTextFile(tab.root, tab.rel);
        const text = content.content.replace(/\r\n/g, "\n");
        let patch = "";
        const repo = roots.find((r) => r.path === tab.root)?.isRepo;
        if (repo && !content.binary) {
          patch = await api.getDiff(tab.root, tab.rel, false, false).catch(() => "");
        }
        setFiles((prev) => {
          const old = prev[key];
          if (quiet && old && old.content === text && old.marks.size === changeMarks(patch).size) return prev;
          const { lines, language } = highlightToLines(text, tab.rel);
          return {
            ...prev,
            [key]: { ...content, content: text, raw: text.split("\n"), html: lines, language, marks: changeMarks(patch) },
          };
        });
      } catch (e) {
        if (!quiet) onError(String(e));
      }
    },
    [roots, onError]
  );

  const openFile = useCallback(
    (rel: string, line?: number, forRoot = root) => {
      const tab = { root: forRoot, rel };
      const key = tabKey(tab);
      setTabs((prev) => (prev.some((t) => tabKey(t) === key) ? prev : [...prev, tab]));
      setActiveKey(key);
      setSelectedLine(line ?? null);
      pendingLine.current = line ?? null;
      void loadFile(tab);
      // reveal it in the explorer (another root is revealed after it loads)
      if (forRoot !== root) pendingReveal.current = tab;
      else {
        const dirs = parentDirs(rel);
        setExpanded((prev) => new Set([...prev, ...dirs]));
        dirs.forEach((d) => {
          if (!children[d]) void loadDir(d);
        });
      }
    },
    [root, children, loadDir, loadFile]
  );

  const closeTab = (key: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => tabKey(t) !== key);
      if (activeKey === key) setActiveKey(next.length ? tabKey(next[next.length - 1]) : null);
      return next;
    });
    setFiles((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  // live-reload the visible file (each poll also runs `git diff`, so only while shown)
  useEffect(() => {
    if (!visible || !activeTab || !active || active.binary || active.size > POLL_MAX_SIZE) return;
    const id = setInterval(() => void loadFile(activeTab, true), POLL_MS);
    return () => clearInterval(id);
  }, [visible, activeTab, active, loadFile]);

  // open requests from App (agent API, palette)
  useEffect(() => {
    if (!openRequest) return;
    const ownerPath = containingRoot(
      roots.map((r) => r.path),
      openRequest.path
    );
    const owner = roots.find((r) => r.path === ownerPath);
    if (!owner || norm(owner.path).length >= norm(openRequest.path).length) {
      return onError(`${openRequest.path} is not a file inside the open workspace`);
    }
    const rel = norm(openRequest.path).slice(norm(owner.path).length + 1);
    if (owner.path !== root) setRoot(owner.path);
    openFile(rel, openRequest.line, owner.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  // scroll to a requested line once the file has rendered
  useEffect(() => {
    const line = pendingLine.current;
    if (!active || line == null || !scrollRef.current) return;
    pendingLine.current = null;
    const el = scrollRef.current;
    el.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - el.clientHeight / 3);
  }, [active]);

  const scrollToLine = (line: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = (line - 1) * LINE_HEIGHT;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - LINE_HEIGHT * 2) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  };

  // ── find / go to line ──
  const matches = useMemo(() => {
    if (bar !== "find" || !active || !barQuery) return [];
    const q = barQuery.toLowerCase();
    const out: number[] = [];
    active.raw.forEach((l, i) => {
      if (l.toLowerCase().includes(q)) out.push(i + 1);
    });
    return out;
  }, [bar, barQuery, active]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const currentMatch = matches.length ? matches[Math.min(matchIndex, matches.length - 1)] : null;

  useEffect(() => {
    if (currentMatch) scrollToLine(currentMatch);
  }, [currentMatch]);

  const openBar = (mode: "find" | "goto") => {
    setBar(mode);
    setBarQuery("");
    setMatchIndex(0);
    // already open: the input won't remount, so refocus it directly
    barInputRef.current?.focus();
  };

  const onBarKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setBar(null);
    if (e.key !== "Enter") return;
    if (bar === "goto") {
      const n = parseInt(barQuery, 10);
      if (active && n >= 1) {
        const line = Math.min(n, active.raw.length);
        setSelectedLine(line);
        scrollToLine(line);
        setBar(null);
      }
    } else if (matches.length) {
      setMatchIndex((i) => (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length));
    }
  };

  // keyboard shortcuts, only while the code view is on screen
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".terminal-host")) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setQuickOpen(true);
      } else if (k === "f" && active) {
        e.preventDefault();
        openBar("find");
      } else if (k === "g" && active) {
        e.preventDefault();
        openBar("goto");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, active]);

  const copyLocation = () => {
    if (!activeTab) return;
    const text = `${activeTab.rel}${selectedLine ? `:${selectedLine}` : ""}`;
    navigator.clipboard.writeText(text).catch(() => {});
  };

  // ── render ──
  const renderTree = (rel: string, depth: number): React.ReactNode =>
    (children[rel] ?? []).map((entry) => {
      const isOpen = expanded.has(entry.path);
      const status = gitStatus.get(entry.path);
      const isActive = activeTab?.root === root && activeTab.rel === entry.path;
      return (
        <div key={entry.path}>
          <button
            className={`tree-row ${isActive ? "active" : ""} ${status ? `git-${status === "•" ? "dir" : status}` : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => (entry.is_dir ? toggleDir(entry.path) : openFile(entry.path))}
            title={entry.path}
          >
            <span className="tree-caret">
              {entry.is_dir ? isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
            </span>
            <span className="tree-icon">{entry.is_dir ? <Folder size={13} /> : <FileIcon size={13} />}</span>
            <span className="tree-name">{entry.name}</span>
            {status && status !== "•" && <span className="tree-status">{status}</span>}
          </button>
          {entry.is_dir && isOpen && renderTree(entry.path, depth + 1)}
        </div>
      );
    });

  return (
    <div className="code-view">
      {explorerOpen && (
        <>
          <aside className="explorer" style={{ width: explorerWidth }}>
            <div className="explorer-header">
              <select
                className="explorer-root"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                aria-label="Folder to browse"
              >
                {roots.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button className="icon-btn" title="Quick open (Ctrl+P)" onClick={() => setQuickOpen(true)}>
                <Search size={13} />
              </button>
              <button className="icon-btn" title="Refresh" onClick={refreshExplorer}>
                <Refresh size={13} />
              </button>
            </div>
            <div className="explorer-tree" role="tree">
              {children[""] ? renderTree("", 0) : <div className="config-hint">Loading…</div>}
            </div>
          </aside>
          <div className="resizer" onMouseDown={onExplorerResize} />
        </>
      )}

      <section className="editor">
        <div className="editor-tabs" role="tablist">
          {tabs.map((t) => {
            const key = tabKey(t);
            return (
              <span
                key={key}
                role="tab"
                aria-selected={key === activeKey}
                className={`editor-tab ${key === activeKey ? "active" : ""}`}
                onClick={() => setActiveKey(key)}
                onAuxClick={(e) => e.button === 1 && closeTab(key)}
                title={`${t.root}/${t.rel}`}
              >
                {baseName(t.rel)}
                <button
                  className="term-close"
                  title="Close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(key);
                  }}
                >
                  <Close size={11} />
                </button>
              </span>
            );
          })}
        </div>

        {activeTab && (
          <div className="editor-breadcrumb">
            <span className="crumb-path">{activeTab.rel.split("/").join(" › ")}</span>
            <button className="icon-btn" title="Copy path:line" onClick={copyLocation}>
              <Copy size={12} />
            </button>
            <button className="icon-btn" title="Reload from disk" onClick={() => void loadFile(activeTab)}>
              <Refresh size={12} />
            </button>
          </div>
        )}

        {bar && (
          <div className="editor-bar">
            <input
              key={bar}
              ref={barInputRef}
              autoFocus
              className="editor-bar-input"
              placeholder={bar === "find" ? "Find in file (Enter / Shift+Enter)" : `Go to line (1–${active?.raw.length ?? 1})`}
              value={barQuery}
              onChange={(e) => {
                setBarQuery(e.target.value);
                setMatchIndex(0);
              }}
              onKeyDown={onBarKey}
              inputMode={bar === "goto" ? "numeric" : undefined}
            />
            {bar === "find" && (
              <span className="bar-count">
                {barQuery ? (matches.length ? `${Math.min(matchIndex, matches.length - 1) + 1} of ${matches.length}` : "No results") : ""}
              </span>
            )}
            <button className="icon-btn" title="Close (Esc)" onClick={() => setBar(null)}>
              <Close size={12} />
            </button>
          </div>
        )}

        <div className="editor-body" ref={scrollRef}>
          {!activeTab ? (
            <div className="welcome-empty">
              <div className="welcome-empty-text">No file open</div>
              <div className="welcome-empty-hint">
                Pick a file in the explorer, or press <kbd>Ctrl</kbd>+<kbd>P</kbd> to open one by name
              </div>
            </div>
          ) : !active ? (
            <div className="config-hint" style={{ padding: 16 }}>Loading…</div>
          ) : active.binary ? (
            <div className="welcome-empty">
              <div className="welcome-empty-text">Binary file</div>
              <div className="welcome-empty-hint">{formatSize(active.size)} — not shown</div>
            </div>
          ) : (
            <div className="code-lines" style={{ ["--gutter-ch" as string]: String(String(active.raw.length).length) }}>
              {active.html.map((html, i) => {
                const n = i + 1;
                const mark = active.marks.get(n);
                const cls = [
                  "code-line",
                  n === selectedLine ? "selected" : "",
                  matchSet.has(n) ? "match" : "",
                  n === currentMatch ? "match-current" : "",
                ].join(" ");
                return (
                  <div key={n} className={cls}>
                    <span className={`line-mark ${mark ?? ""}`} />
                    <span className="line-no" onClick={() => setSelectedLine(n === selectedLine ? null : n)}>
                      {n}
                    </span>
                    <span className="line-code" dangerouslySetInnerHTML={{ __html: html || " " }} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {active && !active.binary && (
          <div className="editor-status">
            <span>{active.language ?? "plain text"}</span>
            <span>{active.raw.length} lines</span>
            <span>{formatSize(active.size)}</span>
            {selectedLine && <span>Ln {selectedLine}</span>}
            {active.marks.size > 0 && <span className="status-changes">{active.marks.size} changed</span>}
            {active.truncated && <span className="status-warn">truncated at 2 MB</span>}
            <span className="status-spacer" />
            <span className="status-hint">Ctrl+F find · Ctrl+G line · Ctrl+P open · read-only</span>
          </div>
        )}
      </section>

      {quickOpen && visible && (
        <QuickOpen
          root={root}
          onPick={(rel) => {
            setQuickOpen(false);
            openFile(rel);
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  );
}

function QuickOpen({ root, onPick, onClose }: { root: string; onPick: (rel: string) => void; onClose: () => void }) {
  const [all, setAll] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listFiles(root).then(setAll).catch(() => setAll([]));
  }, [root]);

  const results = useMemo(() => {
    if (!all) return [];
    if (!query.trim()) return all.slice(0, 50);
    return all
      .map((p) => [p, fuzzyScore(p, query)] as const)
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([p]) => p);
  }, [all, query]);

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[index]) onPick(results[index]);
  };

  return (
    <div className="palette-layer" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Open file"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-search-row">
          <Search size={14} />
          <input
            autoFocus
            placeholder={all ? `Open file by name (${all.length} files)…` : "Indexing files…"}
            aria-label="Search files"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" ref={listRef} role="listbox">
          {results.map((p, i) => (
            <button
              key={p}
              role="option"
              aria-selected={i === index}
              className={`palette-item ${i === index ? "active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onPick(p)}
            >
              <span className="palette-item-main">
                <span>{baseName(p)}</span>
                <small>{p}</small>
              </span>
            </button>
          ))}
          {all && results.length === 0 && <div className="palette-empty">No matching files</div>}
        </div>
      </div>
    </div>
  );
}
