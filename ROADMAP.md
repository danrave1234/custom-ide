# Vide roadmap

A prioritized list of improvements, not a promise of dates. Vide should stay lightweight and focused on running and reviewing work done by coding agents, so reliability and safe distribution come before new surface area.

## Done

These items from earlier versions of this roadmap are finished ("next release" means merged to `main` but not yet released):

- **Signed in-app updates** (0.5.0): one check per launch, verified with the updater key.
- **Command palette** (0.2.0): repos, views and actions; agent launch in 1.0.0; run, stop and restart in the next release.
- **Smaller startup bundle** (1.0.0): the Code view and its syntax highlighter load only when first opened.
- **Sandboxed file reads** (1.0.0): the Code view rejects paths outside the browsed folder, with traversal tests.
- **Crash notifications** (next release): a run that dies on its own shows the error with a Restart action.

## P0: distribution and safety

- **Sign the Windows installer.** Apply to [SignPath Foundation](https://signpath.org/) (free for open-source projects) and sign `Vide_<version>_x64-setup.exe` in the release workflow so SmartScreen stops warning.
- **Replace the disabled CSP.** Define the narrowest Content Security Policy that still supports the UI, terminals and the Code view.
- **Harden the remaining file paths.** Apply the Code view's canonical-path checks to repository and `.env` paths accepted by other backend commands.
- **Preview destructive actions.** Show what discard, force-delete, rebase, force-push and process-kill will do, with recovery guidance.
- **Release smoke test.** Install and launch the built installer in CI before the release is published.

## P1: reliability and tests

- **Configurable auto-restart.** Per-run on/off toggle, include and exclude globs, debounce, and a visible watched-folder indicator.
- **Native file watching.** Replace repeated folder scans with OS file events, keeping polling as a fallback for network drives.
- **Workflow tests.** Frontend component tests and Tauri integration tests for git status, process lifecycle, state migration, sync conflicts and terminal cleanup.
- **Recover interrupted state.** Detect rebases left by a crash and never show a run as active when its process is gone.
- **Diagnostics export.** Bounded, redacted logs and an "Export diagnostics" action that never includes environment values or credentials.

## P2: daily workflow

- **Clickable errors.** Turn `file:line` in compiler and test output into links that open the Code view at that line.
- **Ready checks for groups.** Let a favorites group wait for a port, URL or successful command instead of a fixed delay.
- **Richer git conflict handling.** Stash management, conflict lists, continue, skip and abort controls, tags, and safer detached-HEAD handling.
- **Shareable workspace config.** A readable file teams can commit, without secrets.
- **Accessibility pass.** Screen-reader labels and announcements, and a contrast check across the UI.

## P3: scale and maintainability

- **Very large workspaces.** Incremental, cancellable repository scans, virtualized long lists, and measured performance targets.
- **Versioned state.** Version persisted data and test forward migration and recovery from malformed files.
- **Contribution and security policies.** Setup notes, architecture overview, support expectations, and a private way to report vulnerabilities.
