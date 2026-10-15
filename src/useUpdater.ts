import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "latest" }
  | { status: "available"; update: Update }
  | { status: "downloading"; update: Update; percent: number | null }
  | { status: "installing"; update: Update }
  | { status: "error"; message: string; update?: Update };

// One check shortly after launch, never on a timer. Delayed so it never
// competes with the workspace scan at startup.
const STARTUP_DELAY_MS = 5000;
const CHECK_TIMEOUT_MS = 15000;

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const busy = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) {
      setDismissed(false);
      setState({ status: "checking" });
    }
    try {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (update) setState({ status: "available", update });
      else if (manual) setState({ status: "latest" });
    } catch (e) {
      // Offline, GitHub down, or no release yet: only worth mentioning when asked.
      if (manual) setState({ status: "error", message: `Couldn't check for updates: ${String(e)}` });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    // Extra windows share the process, so only the first window checks.
    if (getCurrentWindow().label !== "main") return;
    const timer = window.setTimeout(() => void runCheck(false), STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  useEffect(() => {
    if (state.status !== "latest") return;
    const timer = window.setTimeout(() => setState({ status: "idle" }), 4000);
    return () => window.clearTimeout(timer);
  }, [state.status]);

  const install = useCallback(async (update: Update) => {
    if (busy.current) return;
    busy.current = true;
    let total = 0;
    let received = 0;
    setState({ status: "downloading", update, percent: null });
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) {
            setState({ status: "downloading", update, percent: Math.min(100, Math.round((received / total) * 100)) });
          }
        }
      });
      setState({ status: "installing", update });
      await invoke("prepare_for_update");
      await update.install();
      await relaunch();
    } catch (e) {
      setState({ status: "error", message: `Update failed: ${String(e)}`, update });
    } finally {
      busy.current = false;
    }
  }, []);

  return {
    state,
    visible: !dismissed && state.status !== "idle",
    checkNow: () => void runCheck(true),
    install: (update: Update) => void install(update),
    dismiss: () => setDismissed(true),
  };
}
