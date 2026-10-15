# Agent Control

VibeDeck exposes a **localhost-only HTTP API** that lets external agents (coding agents, CLI scripts, ChatGPT local tools) control the app: open workspaces, select repos, start/stop runs, read output, and switch views.

## Prerequisites

- VibeDeck must be **running** (the API is embedded in the desktop app).
- The API binds to `127.0.0.1:17321` by default — it is **not accessible from other machines**.
- All endpoints except `/health` require a bearer token (auto-generated on first launch).

## Finding Your Token

The token is stored in the app config directory:

| Platform | Path |
|----------|------|
| Windows | `%LOCALAPPDATA%\vibedeck\agent.json` |
| macOS | `~/Library/Application Support/vibedeck/agent.json` |
| Linux | `~/.config/vibedeck/agent.json` |

The file contains:
```json
{
  "port": 17321,
  "token": "aBcDeFgHiJkLmNoPqRsTuVwX"
}
```

You can also override via environment variables:
- `VIBEDECK_AGENT_PORT` — change the port
- `VIBEDECK_AGENT_TOKEN` — set a custom token

## CLI Usage

The easiest way for agents to control VibeDeck is the built-in CLI:

```bash
# Check if VibeDeck is running
npm run agent -- health

# Get current status
npm run agent -- status

# Open a workspace
npm run agent -- open "C:\projects\my-monorepo"

# Select a repo by name
npm run agent -- select "my-app"

# List detected run configs
npm run agent -- configs "C:\projects\my-app"

# Start a run
npm run agent -- run --name "dev" --command "npm run dev" --cwd "C:\projects\my-app"

# Stop a run
npm run agent -- stop "C:\projects\my-app::dev"

# List running sessions
npm run agent -- runs

# Get run output (last 100 lines)
npm run agent -- output "C:\projects\my-app::dev" --tail 50

# Switch view
npm run agent -- view favorites
npm run agent -- view repo --tab run

# Run a favorites group
npm run agent -- group-run "Backend"
```

## HTTP API Reference

All endpoints use JSON request/response bodies. Auth header: `Authorization: Bearer <token>`.

### `GET /health`
No auth required. Returns `{"status": "ok"}`.

### `GET /v1/status`
Returns current workspace root and persisted state.

### `POST /v1/workspace/open`
```json
{ "path": "C:\\projects\\my-monorepo" }
```
Scans and opens the workspace folder.

### `GET /v1/repos`
Returns list of scanned repos.

### `POST /v1/repo/select`
```json
{ "path": "C:\\projects\\my-app" }
// or
{ "name": "my-app" }
```
Selects a repo in the sidebar.

### `GET /v1/configs?repo=<path>`
Lists detected run configs for a repo.

### `POST /v1/run`
```json
{
  "name": "dev",
  "command": "npm run dev",
  "cwd": "C:\\projects\\my-app",
  "repoPath": "C:\\projects\\my-app"
}
```
Starts a run session. Returns session `id`.

### `POST /v1/run/stop`
```json
{ "id": "C:\\projects\\my-app::dev" }
```
Stops a running session.

### `GET /v1/runs`
Lists all currently running session IDs.

### `GET /v1/runs/output?id=<id>&tail=<N>`
Returns the last N lines of output for a session.

### `POST /v1/view`
```json
{ "view": "favorites" }
// or
{ "view": "repo", "tab": "run" }
```
Switches the current view/tab.

### `POST /v1/group/run`
```json
{ "name": "Backend" }
```
Runs all items in a favorites group sequentially.

## Using from ChatGPT / Coding Agents

For local coding agents (Claude Desktop, ChatGPT local mode, Cursor, etc.):

1. **Find the token** from `agent.json` in your app config directory.
2. **Use curl or fetch** to call the API:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"path": "C:\\projects\\my-app"}' \
        http://127.0.0.1:17321/v1/workspace/open
   ```
3. **Or use the CLI** from your agent's terminal tool:
   ```bash
   VIBEDECK_AGENT_TOKEN=YOUR_TOKEN npm run agent -- open "C:\projects\my-app"
   ```

## Limitations

- **Localhost only**: Remote agents (cloud ChatGPT) cannot reach the API directly. A local bridge process is needed.
- **App must be running**: The API is embedded in the VibeDeck desktop app.
- **Read-only git**: The agent API currently controls runs and navigation; git operations (commit, push) are not exposed yet.
- **No PTY control**: Terminal input is not exposed via the agent API.
