# Changelog

All notable changes to Vide (formerly VibeDeck) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-10-18

### Added

- **Open the app in one click**: when a run prints a local URL (`http://localhost:5173`), its toolbar shows an **Open** button.
- **Install missing dependencies**: the Run tab notices a JS project with a lockfile but no `node_modules` and offers the matching `pnpm`/`yarn`/`bun`/`npm install`.
- **Crash alerts**: a run that exits with an error on its own shows a notice with the real error line, **Restart** and **Show output**. Stopping or restarting a run never triggers it.
- **Run from the command palette**: `Ctrl+K` lists **Run** for favorites and the selected repo's scripts, and **Stop** / **Restart** for running ones.
- **Resume last session**: runs that were active when Vide closed (or updated) are offered once on the next launch.

### Changed

- The Windows app is now fully named Vide: installer, Start menu and desktop shortcuts, Apps list entry and `Vide.exe`. Installing or updating replaces an existing VibeDeck install (no second copy) and keeps all settings. A taskbar pin to the old VibeDeck needs to be pinned again.
- Releases ship only the Windows installer, `Vide_<version>_x64-setup.exe`, plus the `latest.json` used for in-app updates.

### Removed

- MSI, macOS and Linux release packages, and the separate `.sig` files (update signatures live in `latest.json`). macOS and Linux can still be built from source.

## [1.0.0] - 2026-10-17

### Added

- New name and logo: VibeDeck is now **Vide** (Vibe + IDE). Settings, the agent token and the install identifier are unchanged.
- **Code view**: a Dashboard/Code switch (`Ctrl+Shift+E`) with a file explorer (git status colors), tabbed read-only code viewer with line numbers, syntax highlighting, changed-line gutter marks and live reload, plus quick open (`Ctrl+P`), find (`Ctrl+F`) and go to line (`Ctrl+G`). "Open in Code view" from the Changes tab. Agents can open a file at a line with `vide show file:line` / `POST /v1/file/open`.
- **+ Agent** launcher: detects coding-agent CLIs on `PATH` (Claude Code, Codex, Gemini, Cursor Agent, Copilot, Aider, opencode, Amp, Goose, Qwen Code) and opens them in a repo terminal. Also available from the command palette.
- Agent API: `GET /v1` (route discovery), `GET /v1/git/status`, `GET /v1/git/diff`, `GET /v1/agents`, `POST /v1/terminal/open`, `POST /v1/notify`.
- In-app agent notifications with a **Review changes** shortcut, and hook recipes for Claude Code and Codex.
- `vide` CLI binary (`npm link`) with `describe`, `repos`, `git-status`, `diff`, `agents`, `launch`, `terminal` and `notify` commands. `VIDE_AGENT_*` environment variables (the `VIBEDECK_*` names still work).

### Fixed

- The agent CLI looked for its token in the wrong folder, so authenticated commands failed unless `VIBEDECK_AGENT_TOKEN` was set.
- `GET /v1/configs` ignored the `repo` query parameter the CLI sends and always returned 400.
- `GET /v1/repos` returned a placeholder instead of the workspace's repositories.
- Agent UI actions sent while the app was starting (or between internal listener refreshes) were dropped even though the API answered `ok`; they are now queued and replayed, and responses report `queued`. With several windows, an action now goes to one window instead of running in each.

## [0.5.0] - 2026-10-15

### Added

- In-app updates: VibeDeck checks for a new release once after launch (no background polling) and can download, install, and restart itself from an update notice. "Check for updates" is available in the command palette and the `•••` menu.
- Running dev servers and terminals are stopped cleanly before an update installs.

## [0.4.0] - 2026-10-15

### Added

- Localhost-only HTTP agent API for external coding agents to control VibeDeck (open workspace, select repos, start/stop runs, read output, switch views, run favorites groups).
- Node CLI wrapper (`scripts/agent.mjs`) for agent commands, accessible via `npm run agent`.
- Agent API documentation in `docs/agents.md`.
- Auto-folder grouping in the sidebar, with collapsible folders and filter chips (All/Dirty/Running).
- Drag-and-drop favorites into groups, multi-select bulk operations, and inline group rename.
- Shared `SessionOutput` component consolidating session tabs, toolbar, and output pane across views.
- Unified bottom panel combining run output and terminal with mode-switching pills.
- SVG icon set (`Icons.tsx`) replacing all emoji throughout the UI.
- Inter and JetBrains Mono fonts loaded for cleaner UI and code readability.
- `onSuccess` callbacks on git views to clear stale errors on successful load.

### Changed

- Sidebar open by default; repo header shows branch, dirty, ahead/behind badges.
- Favorites group headers collapsed into Run/Stop plus a `•••` overflow menu for less-used actions.
- Group overflow menus now open as fixed-position popups escaping scroll containers.
- All favorites pin/unpin rows redesigned for consistency: leading checkbox only, unpin as a visible filled star in actions.
- RunView pin button uses filled star when pinned.
- NestJS/tsc watch compilation output no longer stacks; ANSI clear-screen and cursor-up sequences processed correctly.
- Git scan validates `.git` directories with `rev-parse --is-inside-work-tree` to filter broken/non-worktree hits.
- Sticky `fatal: not a git repository` errors now clear on repo select and successful git load.
- Welcome screen and topbar copy cleaned of emoji and AI-slop language.
- Env tab now fills the main content area instead of appearing minimized.
- Output ring buffer wired to agent API so `GET /v1/runs/output` returns real run stdout/stderr.
- Agent API URL-decodes session ID query params for Windows path compatibility.

### Fixed

- Clear-screen and cursor-up ANSI control sequences now correctly process in run output instead of stacking.
- Monorepo roots with broken `.git` directories no longer appear as selectable repos.
- Error banners from git operations no longer stick after switching repos or views.

## [0.3.0] - 2026-09-21

Version bump only. The features originally listed for this release were not included in its build and ship in 0.4.0 instead.

## [0.2.0] - 2026-09-08

### Added

- Command palette (`Ctrl+K`) for jumping to repositories, views, and actions.
- Repository filter and "Active first" / "Name" sorting in the sidebar, with tooltips for change, ahead, and behind badges.
- `Ctrl+Enter` commits from the commit message box.
- Visible keyboard focus outlines and keyboard-selectable repositories, tabs, and changed files.

### Changed

- The top bar is simplified: version, build time, Kill port, Open folder, and New window moved into an overflow menu.
- The selected repository shows an accent bar in addition to its background color.

## [0.1.0] - 2026-09-07

### Added

- Initial VibeDeck desktop application with workspace discovery, Git workflows, run configurations, favorites, repository sync, environment editing, terminal sessions, and port management.
- Automatic reruns when local repository source files change.
- A synchronized SemVer command for npm, Tauri, and Cargo manifests.
- Continuous integration for frontend and Rust validation.
- Draft GitHub Releases with Windows, Linux, Intel macOS, and Apple Silicon macOS packages.
- The app version in the top bar for easier build identification.

### Changed

- Production package metadata now uses the VibeDeck product name and description.

[Unreleased]: https://github.com/danrave1234/custom-ide/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/danrave1234/custom-ide/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/danrave1234/custom-ide/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/danrave1234/custom-ide/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/danrave1234/custom-ide/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/danrave1234/custom-ide/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/danrave1234/custom-ide/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/danrave1234/custom-ide/tree/v0.1.0
