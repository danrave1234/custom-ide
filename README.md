<p align="center">
  <img src="assets/brand/vide-icon.svg" width="112" alt="Vide logo" />
</p>

<h1 align="center">Vide</h1>

<p align="center">
  <strong>The lightweight IDE for vibe coding.</strong><br />
  Launch your coding agents, read what they wrote, see what changed, and run it.
</p>

<p align="center">
  <a href="https://github.com/danrave1234/custom-ide/releases/latest"><img src="https://img.shields.io/github/v/release/danrave1234/custom-ide?label=download" alt="Latest release" /></a>
  <a href="https://github.com/danrave1234/custom-ide/actions/workflows/ci.yml"><img src="https://github.com/danrave1234/custom-ide/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/danrave1234/custom-ide" alt="MIT license" /></a>
</p>

---

**Vide** (Vibe + IDE, and Latin for "see") is a desktop app built around coding agents such as Claude Code, Codex CLI and Gemini CLI. The agents write the code. Vide is where you launch them, browse the code, review their changes, run your projects, and get pinged when an agent is done or needs you.

Think of it as IntelliJ's project view, git panel and run configurations, plus a seat for every agent, without the other 2 GB. It is built with Tauri 2, React and TypeScript and uses the system webview, so there is no bundled Chromium. Vide was previously called VibeDeck.

## Contents

- [Download](#download)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Working with coding agents](#working-with-coding-agents)
- [Development](#development)
- [Releases and updates](#releases-and-updates)
- [Project layout](#project-layout)
- [License](#license)

## Download

1. Download **`Vide_<version>_x64-setup.exe`** from the [latest release](https://github.com/danrave1234/custom-ide/releases/latest).
2. Run it. Installing over VibeDeck replaces it and keeps your settings.

> [!NOTE]
> The installer is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.

Installed copies update themselves. Only Windows builds are published; on macOS or Linux, [build from source](#development).

## Features

### Coding agents

- **+ Agent launcher.** Lists every agent CLI on your `PATH` (Claude Code, Codex, Gemini, Cursor Agent, Copilot, Aider, opencode, Amp, Goose, Qwen Code) and opens it in a terminal tab in the selected repo.
- **Agent control API and `vide` CLI.** Agents can open workspaces, start, stop and tail dev servers, read git status and diffs, open terminals, and point you at a file and line.
- **Notifications.** `vide notify "done" --repo` shows a notice with a one-click **Review changes** jump to that repo's diff. Hook recipes for Claude Code and Codex are in [`docs/agents.md`](docs/agents.md).

### Code

- **Code view.** Switch between **Dashboard** and **Code** in the top bar. Browse any repo in a file explorer with git status colors and open files in tabs.
- **Readable by default.** Line numbers, syntax highlighting, and green and red gutter marks on lines an agent changed. Files reload live while agents edit them.
- **Read-only on purpose.** Agents write; you read, find in file, jump to a line, or open the full file straight from a diff.

### Running

- **Run configs, detected for you.** Scripts from `package.json` (npm, pnpm, yarn, bun, including monorepo packages), Maven, Gradle, Cargo and docker-compose, plus your own saved commands.
- **Open in one click.** When a dev server prints `http://localhost:5173`, the run shows an **Open** button.
- **Missing dependencies.** A project with a lockfile but no `node_modules` gets a one-click `pnpm`, `yarn`, `bun` or `npm install`.
- **Crash alerts.** A run that dies on its own shows the real error line with **Restart** and **Show output**.
- **Auto-restart.** Runs restart when their source files change. A port conflict offers **Free port and restart**.
- **Resume last session.** Whatever was running when Vide closed is offered again on the next launch.
- **Favorites.** Pin configs from any repo, group them, and start a whole group in order with a delay between starts.
- **Clean exit.** Closing Vide stops every process it started, so no orphaned dev servers.

### Git

- **Changes.** Stage, unstage and discard files, read colored diffs, and commit.
- **Branches and history.** Switch, create and delete branches, fetch, pull and push, and browse the commit log with full diffs.
- **Sync repos.** Fetch and rebase several repos onto `origin/<branch>`, optionally build and `push --force-with-lease`. Force-push is skipped on protected branches.
- **Your real git.** Every operation shells out to the `git` CLI, so credentials, hooks and config behave exactly like your terminal.

### Workspace

- **Folder of repos.** Open any folder and every git repository inside it, up to 3 levels deep, appears with its branch, changed-file count and ahead/behind markers.
- **Terminals.** A bottom panel with tabbed terminals that open in the selected repo.
- **Env editor.** View and edit each repo's `.env*` files, up to 2 levels deep.
- **Kill port.** Find and kill whatever is holding a port.
- **Multiple windows** for multiple workspaces.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Command palette: repos, views, run, stop, restart, launch agents |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> | Switch between Dashboard and Code view |
| <kbd>Ctrl</kbd>+<kbd>&#96;</kbd> | Show or hide the terminal panel |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Commit (in the commit message box) |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Open a file by name (Code view) |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Find in the open file (Code view) |
| <kbd>Ctrl</kbd>+<kbd>G</kbd> | Go to line (Code view) |

Every control is also reachable with <kbd>Tab</kbd>, with a visible focus outline.

## Working with coding agents

Vide runs a localhost-only HTTP API, and the `vide` CLI wraps it:

```bash
npm link                      # once, from this repo: puts `vide` on your PATH
vide launch claude            # open Claude Code in a terminal tab here
vide show src/App.tsx:42      # open a file in the Code view at line 42
vide notify "Tests green" --level success --repo
```

See [`docs/agents.md`](docs/agents.md) for the full CLI, the HTTP API, and hook recipes for Claude Code and Codex.

## Development

Requirements: Node 22+, stable Rust, and the WebView2 runtime (preinstalled on Windows 11).

```bash
npm install
npm run tauri dev       # run the app with hot reload
npm run tauri build     # build the Windows installer
```

On macOS or Linux, choose a bundle format explicitly:

```bash
npm run tauri build -- --bundles dmg        # macOS
npm run tauri build -- --bundles appimage   # Linux
```

| Command | Checks |
| --- | --- |
| `npm run build` | TypeScript typecheck and frontend production build |
| `npm run test:ui` | Code view and run-output helpers |
| `npm run test:cli` | The `vide` CLI |
| `npm run test:version` | Version tooling |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust backend |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Rust formatting |

CI runs all of these, plus a version-sync check, on every pull request and every push to `main`.

## Releases and updates

Vide follows [Semantic Versioning](https://semver.org/). One command keeps the version in sync across npm, Tauri and Cargo:

```bash
npm run version:set -- 1.1.0
npm run version:check
```

To publish a release:

1. Run `npm run version:set -- <version>` and move the `[Unreleased]` notes in [`CHANGELOG.md`](CHANGELOG.md) under the new version.
2. Commit, then tag the commit, for example `git tag v1.1.0`, and push both.
3. The **Release** workflow checks that the tag matches the manifests, builds `Vide_<version>_x64-setup.exe` and `latest.json`, and attaches them to a draft release.
4. Review the draft and publish it.

### In-app updates

Installed copies check for a newer release once, a few seconds after launch, and on demand from **Check for updates** in the command palette or the `•••` menu. There is no background polling. Only published releases are offered, never drafts or pre-releases.

**Update and restart** downloads the new installer, stops running dev servers and terminals, installs, and relaunches.

Updates are verified with a separate updater key, not an OS code-signing certificate:

- The public key is in `src-tauri/tauri.conf.json`.
- The private key is the `TAURI_SIGNING_PRIVATE_KEY` repository secret, plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has a password.
- To build signed update bundles locally, set `TAURI_SIGNING_PRIVATE_KEY` before `npm run tauri build`.

> [!WARNING]
> Keep a backup of the private key. If it is lost, existing installs can no longer verify updates and every user has to reinstall manually.

See [`ROADMAP.md`](ROADMAP.md) for planned work.

## Project layout

| Path | What it holds |
| --- | --- |
| `src/` | React frontend; views live in `src/components/` |
| `src/components/CodeView.tsx` | File explorer and code viewer |
| `src/runSmarts.ts`, `src/codeLines.ts` | Run-output and code-view helpers |
| `src-tauri/src/git.rs` | Git CLI wrappers: status, branches, diffs, commits, sync |
| `src-tauri/src/runs.rs` | Run detection, process spawn, output streaming, last session |
| `src-tauri/src/files.rs` | Sandboxed directory listing and file reads for the Code view |
| `src-tauri/src/agent.rs` | Localhost agent HTTP API |
| `src-tauri/src/agents.rs` | Coding-agent CLI detection |
| `src-tauri/windows/installer-hooks.nsh` | Installer step that replaces an old VibeDeck install |
| `scripts/agent.mjs` | The `vide` CLI |
| `assets/brand/` | Logo source; `npx tauri icon assets/brand/vide-icon.svg` regenerates the app icons |

## License

[MIT](LICENSE) © 2026 Danrave
