# ⚡ VibeDeck

A lightweight desktop app for AI-assisted ("vibe") coding: you don't write code in it — you **see what the AI changed and run your projects**. Think of it as the git panel + run configurations from IntelliJ, without the other 2 GB.

Built with **Tauri 2 + React + TypeScript** (uses the OS webview — no bundled Chromium).

## Features

- **Workspace = folder of repos.** Open any folder; every git repository inside (up to 3 levels deep) shows up with its branch, dirty-file count, and ahead/behind markers. Filter and sort repos in the sidebar. Recent-workspace switcher in the top bar; multiple windows for multiple workspaces.
- **Keyboard-first** — `Ctrl+K` command palette for repos, views, and actions; Ctrl+backtick toggles the terminal; `Ctrl+Enter` commits; every control is reachable by Tab with visible focus.
- **Changes / Branches / History** — stage/unstage/discard, colored unified diffs, commit; switch/create/delete branches, fetch/pull/push; commit log with full diffs.
- **Run** — IntelliJ-style run configs auto-detected from `package.json` scripts (npm/pnpm/yarn/bun, monorepo sub-packages included), Maven, Gradle, Cargo, docker-compose — plus saved custom commands per repo. Searchable and filterable.
- **Favorites (landing page)** — pin configs from any repo, organize them into icon-labeled groups, drag to reorder, and run a whole group sequentially with a configurable delay between starts. Run all / Stop all.
- **Sync repos** — checkbox repos, then fetch → rebase onto `origin/<branch>` (autostash optional) → optional build → optional `git push --force-with-lease`, with force-push auto-skipped on protected branches and one-click `rebase --abort` for conflicts.
- **Terminal everywhere** — persistent bottom drawer with per-session tabs, automatic rerun after local source changes, ⟳ manual restart (kill tree → wait → rerun), ⧉ copy output, rolling 2k-line buffer, batched rendering that stays smooth under chatty dev-server output.
- **Env editor** — view/edit each repo's `.env*` files (2 levels deep) with unsaved-change guards.
- **🔌 Kill port** — find and kill whatever is squatting on a port.
- Closing the app kills every process it started — no orphaned dev servers.

All git operations shell out to your real `git` CLI, so credentials, hooks, and config behave exactly like your terminal.

## Development

```sh
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # produce a distributable installer
```

Requires Node 22+, Rust (stable), and the WebView2 runtime (preinstalled on Windows 11).

CI checks synchronized versions, version-tool tests, the frontend production build, Rust formatting, and Rust tests on every pull request and push to `main`.

## Versioning and releases

VibeDeck uses [Semantic Versioning](https://semver.org/). The version is kept in sync across npm, Tauri, and Cargo metadata by one command:

```sh
npm run version:set -- 0.2.0
npm run version:check
```

To publish a release:

1. Run `npm run version:set -- <version>` and update `CHANGELOG.md`.
2. Commit the version and changelog changes.
3. Create a matching tag, such as `git tag v0.2.0`, and push the commit and tag.
4. The `Release` GitHub Actions workflow validates the tag and builds Windows, Linux, Intel macOS, and Apple Silicon macOS installers.
5. Review the generated draft GitHub Release and publish it when the assets are ready.

The workflow deliberately rejects a tag whose version does not match the manifests. Current community packages are unsigned, so Windows and macOS may display trust warnings until code-signing certificates are configured.

### In-app updates

Installed copies check for a newer release once, a few seconds after launch (and on demand from **Check for updates** in the command palette or the `•••` menu). There is no background polling. The check downloads `latest.json` from the latest *published* GitHub Release, so drafts and pre-releases are never offered. Clicking **Update and restart** downloads the signed bundle, stops running dev servers and terminals, installs, and relaunches. Windows (NSIS and MSI), macOS, and Linux (AppImage, `.deb`, `.rpm`) are supported; `.deb`/`.rpm` installs ask for an administrator password.

Updates are signed with a separate updater key (not an OS code-signing certificate). The public key lives in `src-tauri/tauri.conf.json`; the private key must be stored as the `TAURI_SIGNING_PRIVATE_KEY` repository secret (plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has a password). Keep a backup of the private key: if it is lost, existing installs can no longer verify updates and users must reinstall manually. To build signed installers locally, set `TAURI_SIGNING_PRIVATE_KEY` in your shell before `npm run tauri build`.

See [`ROADMAP.md`](ROADMAP.md) for the prioritized product and engineering improvements still worth tackling.

## Layout

- `src/` — React frontend (views in `src/components/`, git patch parser in `src/diff.ts`, ANSI parser in `src/ansi.ts`)
- `src-tauri/src/git.rs` — git CLI wrappers (status, branches, diffs, commits, sync)
- `src-tauri/src/runs.rs` — run-config detection + process spawn/stream/kill
- `src-tauri/src/store.rs` — JSON persistence for workspace + saved run configs
