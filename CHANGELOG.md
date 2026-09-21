# Changelog

All notable changes to VibeDeck will be documented in this file. The project follows [Semantic Versioning](https://semver.org/) and the format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.3.0] - 2026-09-21

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