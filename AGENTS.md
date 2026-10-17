# Working on Vide

Vide (formerly VibeDeck) is a Tauri 2 desktop app: a React + TypeScript frontend in `src/` and a Rust backend in `src-tauri/src/`. It is a cockpit for coding agents: git review, run configs, terminals, and a localhost agent API.

## Commands

- `npm run tauri dev` runs the app with hot reload.
- `npm run build` typechecks (`tsc`) and builds the frontend. Run it after any frontend change.
- `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo fmt --manifest-path src-tauri/Cargo.toml --check` for the backend.
- `npm run test:ui` tests the code-view helpers in `src/codeLines.ts`.
- `npm run test:cli` tests the `vide` CLI; `npm run test:version` tests version tooling.

## Map

- `src-tauri/src/lib.rs` registers every Tauri command. A new `#[tauri::command]` must be added to `generate_handler!` there and wrapped in `src/api.ts`.
- `src-tauri/src/agent.rs` is the agent HTTP API. Every route also goes in `describe()` (a test enforces the important ones) and in `docs/agents.md`.
- UI actions requested by the API are emitted as `agent-ui` events and handled in the bridge effect in `src/App.tsx`.
- `src-tauri/src/agents.rs` holds the list of known agent CLIs.
- `src/components/CodeView.tsx` is the explorer/viewer (lazy-loaded); its file access goes through `src-tauri/src/files.rs`, which must keep rejecting paths outside the browsed root.
- `scripts/agent.mjs` is the `vide` CLI. Every command prints JSON.

## Rules

- Git operations shell out to the real `git` CLI; don't add a git library.
- The bundle identifier `com.danrave.vibedeck` and the `vibedeck-state.json` file name are kept on purpose so existing installs keep their data and updates. Don't rename them.
- Versions are synced across `package.json`, `tauri.conf.json` and `Cargo.toml` with `npm run version:set -- <x.y.z>`; never edit one by hand.
- Add user-facing changes to `CHANGELOG.md` under `[Unreleased]`.
