<p align="center">
  <img src="assets/brand/vide-icon.svg" width="112" alt="Vide logo" />
</p>

# Vide

**The IDE for vibe coding.** *Vide* = Vibe + IDE, and Latin for "see": see what your agents changed.

Vide is a lightweight desktop IDE built around coding agents like Claude Code, Codex CLI and Gemini CLI. The agents write the code; you launch them, **browse and read the code, see what they changed, run your projects, and get pinged when an agent is done or needs you**. Think of it as IntelliJ's project view, git panel and run configurations, plus a seat for every agent, without the other 2 GB.

*(Formerly VibeDeck.)*

Built with **Tauri 2 + React + TypeScript** (uses the OS webview — no bundled Chromium).

## Features

- **Code view.** Switch between **Dashboard** and **Code** in the top bar (`Ctrl+Shift+E`). Browse any repo in a file explorer with git status colors, open files in tabs with line numbers, syntax highlighting and green/red gutter marks for lines the agent changed. Files reload live as agents edit them. `Ctrl+P` opens a file by name, `Ctrl+F` finds in the file, `Ctrl+G` jumps to a line. The Changes tab has **Open in Code view** to jump from a diff to the full file. Read-only on purpose: agents write, you read.
- **Launch coding agents.** The **+ Agent** menu in the bottom panel lists every agent CLI on your `PATH` (Claude Code, Codex, Gemini, Cursor Agent, Copilot, Aider, opencode, Amp, Goose, Qwen Code) and opens it in a terminal tab in the selected repo. Also in the `Ctrl+K` palette.
- **Agent control API and `vide` CLI.** Agents can open workspaces, start/stop and tail dev servers, read git status and diffs, open terminals, and post notifications back to you. Hook recipes for Claude Code and Codex are in [`docs/agents.md`](docs/agents.md).
- **Agent notifications.** `vide notify "done" --repo` pops a notice in the app with a one-click **Review changes** jump to that repo's diff.
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

Vide uses [Semantic Versioning](https://semver.org/). The version is kept in sync across npm, Tauri, and Cargo metadata by one command:

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
- `src-tauri/src/agent.rs` — localhost agent HTTP API; `src-tauri/src/agents.rs` — agent CLI detection
- `src/components/CodeView.tsx` — explorer + code viewer; `src-tauri/src/files.rs` — sandboxed directory listing and file reads
- `scripts/agent.mjs` — the `vide` CLI (`npm link` to install it)
- `assets/brand/` — logo source (`npx tauri icon assets/brand/vide-icon.svg` regenerates the app icons)
