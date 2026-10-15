import { openUrl } from "@tauri-apps/plugin-opener";
import type { useUpdater } from "../useUpdater";
import { Close, Download } from "./Icons";

const RELEASES_URL = "https://github.com/danrave1234/custom-ide/releases/latest";

interface Props {
  updater: ReturnType<typeof useUpdater>;
  runningCount: number;
}

export default function UpdateNotice({ updater, runningCount }: Props) {
  const { state, visible, install, dismiss } = updater;
  if (!visible) return null;

  const busy = state.status === "downloading" || state.status === "installing";
  const update = "update" in state ? state.update : undefined;

  let message: string;
  switch (state.status) {
    case "checking":
      message = "Checking for updates…";
      break;
    case "latest":
      message = `You're on the latest version (v${__APP_VERSION__}).`;
      break;
    case "available":
      message =
        `VibeDeck v${state.update.version} is available.` +
        (runningCount > 0 ? ` Updating restarts the app and stops ${runningCount} running process${runningCount === 1 ? "" : "es"}.` : "");
      break;
    case "downloading":
      message = `Downloading v${state.update.version}…${state.percent !== null ? ` ${state.percent}%` : ""}`;
      break;
    case "installing":
      message = `Installing v${state.update.version}. VibeDeck will restart.`;
      break;
    case "error":
      message = state.message;
      break;
    default:
      return null;
  }

  return (
    <div className={`update-bar ${state.status === "error" ? "update-bar-error" : ""}`} role="status">
      <Download size={14} />
      <span className="update-message">{message}</span>
      {state.status === "downloading" && state.percent !== null && (
        <span className="update-progress" aria-hidden="true">
          <span style={{ width: `${state.percent}%` }} />
        </span>
      )}
      {update && !busy && (
        <>
          <button className="mini-btn" onClick={() => void openUrl(RELEASES_URL)}>
            Release notes
          </button>
          <button className="primary-btn update-btn" onClick={() => install(update)}>
            {state.status === "error" ? "Try again" : "Update and restart"}
          </button>
        </>
      )}
      {!busy && (
        <button className="icon-btn" onClick={dismiss} aria-label="Dismiss" title="Dismiss">
          <Close size={14} />
        </button>
      )}
    </div>
  );
}
