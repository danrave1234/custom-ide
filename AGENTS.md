# Working on Vide

Vide (formerly VibeDeck) is a Tauri 2 desktop app: a React and TypeScript frontend in `src/` and a Rust backend in `src-tauri/src/`. It is a lightweight IDE for coding agents: code view, git review, run configs, terminals, and a localhost agent API.

## Commands

| Command | Use it for |
| --- | --- |
| `npm run tauri dev` | Run the app with hot reload |
| `npm run build` | Typecheck and build the frontend; run after any frontend change |
| `npm run test:ui` | Unit tests for `src/codeLines.ts` and `src/runSmarts.ts` |
| `npm run test:cli` | Tests for the `vide` CLI |
| `npm run test:version` | Tests for the version tooling |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Rust formatting |

## Map

- **Tauri commands:** `src-tauri/src/lib.rs` registers every command. A new `#[tauri::command]` must be added to `generate_handler!` there and wrapped in `src/api.ts`.
- **Agent HTTP API:** `src-tauri/src/agent.rs`. Every route also goes in `describe()` (a test checks the important ones) and in `docs/agents.md`.
- **Agent UI actions:** the API emits `agent-ui` events, handled by the bridge in `src/App.tsx`. The backend queues them until a window calls `agent_ui_ready`.
- **Agent CLIs:** the list of known coding-agent CLIs is in `src-tauri/src/agents.rs`.
- **Runs:** `src-tauri/src/runs.rs` detects run configs, spawns and streams processes, finds missing dependencies, and saves the last session. Output heuristics (local URLs, error lines) are in `src/runSmarts.ts`.
- **Code view:** `src/components/CodeView.tsx` is lazy-loaded. Its file access goes through `src-tauri/src/files.rs`, which must keep rejecting paths outside the browsed root.
- **CLI:** `scripts/agent.mjs` is the `vide` CLI. Every command prints JSON.
- **Releases:** `.github/workflows/release.yml` builds only the Windows NSIS installer and `latest.json`.

## Rules

- Git operations shell out to the real `git` CLI. Don't add a git library.
- Keep these names: the bundle identifier `com.danrave.vibedeck`, the Rust crate `vibedeck` and the `vibedeck-state.json` file. Existing installs depend on them for their data and updates.
- Keep `src-tauri/windows/installer-hooks.nsh` while VibeDeck installs may still be updating. It replaces an install made under the old product name. Changing `productName` again needs the same treatment.
- Change versions only with `npm run version:set -- <x.y.z>`, which syncs `package.json`, `tauri.conf.json` and `Cargo.toml`. Never edit one by hand.
- Add user-facing changes to `CHANGELOG.md` under `[Unreleased]`.
