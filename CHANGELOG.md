# Changelog

All notable changes to Vide (formerly VibeDeck) will be documented in this file. The project follows [Semantic Versioning](https://semver.org/) and the format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

## [0.1.0]

### Added

- Initial VibeDeck desktop application with workspace discovery, Git workflows, run configurations, favorites, repository sync, environment editing, terminal sessions, and port management.
- Automatic reruns when local repository source files change.
- A synchronized SemVer command for npm, Tauri, and Cargo manifests.
- Continuous integration for frontend and Rust validation.
- Draft GitHub Releases with Windows, Linux, Intel macOS, and Apple Silicon macOS packages.
- The app version in the top bar for easier build identification.

### Changed

- Production package metadata now uses the VibeDeck product name and description.