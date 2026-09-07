import { useState } from "react";
import * as api from "../api";
import type { PortProcess } from "../api";

interface Props {
  onClose: () => void;
}

export default function KillPortModal({ onClose }: Props) {
  const [port, setPort] = useState("");
  const [results, setResults] = useState<PortProcess[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lookup = async () => {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setMessage("Enter a port between 1 and 65535.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      setResults(await api.portLookup(n));
    } catch (e) {
      setMessage(String(e));
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const kill = async (proc: PortProcess) => {
    try {
      await api.killPid(proc.pid);
      setMessage(`Killed ${proc.name} (PID ${proc.pid}).`);
      await lookup();
    } catch (e) {
      setMessage(String(e));
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog">
        <div className="modal-header">
          <span>🔌 Kill port</span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            lookup();
          }}
        >
          <input
            autoFocus
            placeholder="Port (e.g. 3000)"
            value={port}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
          />
          <button className="primary-btn" type="submit" disabled={loading || !port}>
            {loading ? "…" : "Find"}
          </button>
        </form>

        {message && <div className="modal-message">{message}</div>}

        {results !== null && (
          <div className="port-results">
            {results.length === 0 ? (
              <div className="config-hint">Nothing is listening on port {port}.</div>
            ) : (
              results.map((p) => (
                <div className="port-row" key={p.pid}>
                  <div className="config-info">
                    <span className="config-name">
                      {p.name} <span className="port-pid">PID {p.pid}</span>
                    </span>
                    <span className="config-command">
                      {p.addresses} · {p.state}
                    </span>
                  </div>
                  <button className="mini-btn danger" onClick={() => kill(p)}>
                    ✕ Kill
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
