import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import "@xterm/xterm/css/xterm.css";

interface Props {
  id: string;
  cwd: string;
  /** typed into the shell once it opens (agent CLI launches) */
  command?: string;
  visible: boolean;
}

const THEME = {
  background: "#0b0e13",
  foreground: "#d7dde8",
  cursor: "#7c6cff",
  selectionBackground: "rgba(124,108,255,0.35)",
  black: "#0b0e13",
  brightBlack: "#8a94a6",
};

/** Each mount gets its own backend PTY session id (see the effect below). */
let mountCounter = 0;

export default function TerminalPane({ id, cwd, command, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(id);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    try {
      fit.fit();
    } catch {
      /* host not laid out yet */
    }

    // A fresh session id per mount, opened one tick later: React StrictMode
    // mounts, unmounts and remounts immediately in dev. With a shared id the
    // stale cleanup's pty_close could kill the live shell, and an eager open
    // would type a launch command (e.g. `claude`) into a shell about to die.
    const sid = `${id}#${++mountCounter}`;
    sessionRef.current = sid;
    let opened = false;
    const openTimer = setTimeout(() => {
      opened = true;
      api.ptyOpen(sid, cwd, term.rows, term.cols, command).catch((e) => {
        term.write(`\x1b[31mCould not start a shell: ${String(e)}\x1b[0m\r\n`);
      });
    }, 0);

    const inputSub = term.onData((data) => api.ptyInput(sid, data).catch(() => {}));

    const outputUnlisten = listen<{ id: string; data: string }>("pty-output", (e) => {
      if (e.payload.id === sid && !disposed) term.write(e.payload.data);
    });
    const exitUnlisten = listen<{ id: string }>("pty-exit", (e) => {
      if (e.payload.id === sid && !disposed) {
        term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      }
    });

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      try {
        fit.fit();
        if (opened) api.ptyResize(sid, term.rows, term.cols).catch(() => {});
      } catch {
        /* ignore transient layout errors */
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      inputSub.dispose();
      ro.disconnect();
      outputUnlisten.then((fn) => fn());
      exitUnlisten.then((fn) => fn());
      clearTimeout(openTimer);
      if (opened) api.ptyClose(sid).catch(() => {});
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // refit + focus when this tab becomes visible (fit is unreliable while hidden)
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term) {
          api.ptyResize(sessionRef.current, term.rows, term.cols).catch(() => {});
          term.focus();
        }
      } catch {
        /* ignore */
      }
    }, 30);
    return () => clearTimeout(t);
  }, [visible, id]);

  return <div className="terminal-host" ref={hostRef} style={{ display: visible ? "block" : "none" }} />;
}
