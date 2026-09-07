import { useMemo, useState } from "react";
import * as api from "../api";
import type { OutputLine, RunSession } from "../types";

const CONFLICT = /(EADDRINUSE|address already in use|is in use|already in use)/i;

function extractPort(text: string): number | null {
  const named = text.match(/port\s+(\d{2,5})/i);
  if (named) return Number(named[1]);
  const colons = [...text.matchAll(/:(\d{2,5})(?!\d)/g)];
  if (colons.length) return Number(colons[colons.length - 1][1]);
  return null;
}

/** Scan recent output for a port-conflict error and return the blocked port. */
export function detectBlockedPort(lines: OutputLine[]): number | null {
  const start = Math.max(0, lines.length - 200);
  for (let i = lines.length - 1; i >= start; i--) {
    const text = lines[i].text;
    if (CONFLICT.test(text)) {
      const port = extractPort(text);
      if (port && port > 0 && port <= 65535) return port;
    }
  }
  return null;
}

interface Props {
  session: RunSession;
  onRestart: (session: RunSession) => void;
  onError: (msg: string) => void;
}

/** Appears when the session output shows "port in use" — kills whatever
 * holds the port and restarts the run, no digging through netstat. */
export default function FreePortButton({ session, onRestart, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const port = useMemo(() => detectBlockedPort(session.lines), [session.lines]);

  if (!port) return null;

  const freeAndRestart = async () => {
    setBusy(true);
    try {
      const procs = await api.portLookup(port);
      for (const p of procs) {
        await api.killPid(p.pid).catch(() => {});
      }
      onRestart(session);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="mini-btn danger"
      disabled={busy}
      title={`Kill whatever is on port ${port}, then restart this run`}
      onClick={freeAndRestart}
    >
      {busy ? "⏳…" : `🔌 Free port ${port} & restart`}
    </button>
  );
}
