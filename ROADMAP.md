# VibeDeck roadmap

This is a prioritized set of improvements rather than a promise of dates. Reliability and safe distribution should come before adding more surface area.

## P0 — distribution and safety

- **Sign release packages.** Add Windows code signing and Apple Developer ID signing/notarization so installers do not trigger avoidable trust warnings.
- **Add secure automatic updates.** Configure Tauri's signed updater only after the signing key has a documented backup and rotation process.
- **Replace the disabled CSP.** Define the narrowest Content Security Policy that supports the local Tauri UI and terminal functionality.
- **Harden filesystem boundaries.** Canonicalize and verify every repository and `.env` path accepted by backend commands; add traversal and symlink tests.
- **Expand destructive-action protection.** Clearly preview discard, force-delete, rebase, force-push, and process-kill operations, with actionable recovery guidance.
- **Add release smoke tests.** Install and launch each generated package in CI or a post-build test environment before publishing it.

## P1 — reliability and test coverage

- **Make auto-restart configurable per run.** Add an on/off toggle, include/exclude globs, debounce settings, and an indicator showing what directory is watched.
- **Use native filesystem notifications.** Replace repeated full-tree scans with an event-driven watcher and retain a polling fallback for network filesystems.
- **Test full workflows.** Add frontend component tests and Tauri integration tests for Git status, process lifecycle, persistence migration, sync conflict handling, and terminal cleanup.
- **Recover interrupted state.** Detect processes or rebases left by crashes, explain what can be recovered, and never imply a process is running when it is not.
- **Add structured diagnostics.** Write bounded, redacted logs and expose an “Export diagnostics” action that never includes environment values or credentials.

## P2 — daily workflow improvements

- **Notifications and problem matching.** Notify when background runs finish and make compiler/test errors clickable when a file and line can be parsed.
- **Run dependencies and health checks.** Let groups wait for ports, URLs, or successful commands instead of relying only on fixed delays.
- **Richer Git conflict handling.** Add stash management, conflict lists, continue/skip/abort controls, tags, and safer detached-HEAD handling.
- **Workspace search and command launcher.** Provide keyboard-first navigation across repositories, branches, commands, and recent actions.
- **Import/export settings.** Support a human-readable workspace configuration that teams can review and share without secrets.
- **Accessibility pass.** Complete keyboard navigation, visible focus states, semantic labels, screen-reader announcements, and contrast checks.

## P3 — scale and maintainability

- **Reduce the frontend bundle.** Split large views and terminal code so startup does not load features that are not yet visible.
- **Handle very large workspaces.** Make repository scanning incremental, cancel stale scans, virtualize long lists, and publish measured performance targets.
- **Formalize state migrations.** Version persisted data and test forward migration, malformed data recovery, and rollback behavior.
- **Add opt-in update/error metrics.** If telemetry is introduced, keep it disabled by default, disclose every collected field, and avoid source paths and command output.
- **Publish contribution and security policies.** Add contribution setup, architecture notes, support expectations, and a private vulnerability-reporting path.

## Suggested release sequence

1. Ship `0.2.0` with CI, synchronized versioning, draft multi-platform packages, and the current auto-restart feature.
2. Ship `0.3.0` with signed packages, updater infrastructure, CSP hardening, and release smoke tests.
3. Ship `0.4.0` with configurable native file watching, diagnostics, and broader integration coverage.
4. Consider `1.0.0` only after persistence migrations, destructive-operation recovery, signed updates, and supported-platform smoke tests are routine.