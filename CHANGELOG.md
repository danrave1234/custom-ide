# Changelog

All notable changes to VibeDeck will be documented in this file. The project follows [Semantic Versioning](https://semver.org/) and the format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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