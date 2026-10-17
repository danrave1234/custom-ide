# Vide for coding agents

Vide is built to sit next to coding-agent CLIs (Claude Code, Codex CLI, Gemini CLI, Cursor Agent, Copilot CLI, Aider, opencode, Amp, Goose, Qwen Code). The agents write the code; Vide is where you read it, review the diffs, run the stack, and get told when an agent needs you.

There are three ways agents and Vide work together:

1. **Launch agents from Vide.** The bottom panel has a **+ Agent** menu listing every agent CLI found on your `PATH`. Picking one opens a terminal tab in the selected repo and starts the agent there. The command palette (`Ctrl+K`) has a "Launch …" entry for each one too.
2. **Let agents drive Vide.** A localhost-only HTTP API (and the `vide` CLI wrapping it) lets an agent open workspaces, start/stop dev servers, read their output, check git status and diffs, and open terminals.
3. **Let agents tap you on the shoulder.** `vide notify` shows a notification in the app, with a **Review changes** button that jumps to the repo's diff. Wire it into your agent's hooks so you know the moment a run finishes or the agent is waiting on you.

## Contents

- [Setup](#setup)
- [CLI](#cli)
- [Hook recipes](#hook-recipes)
- [HTTP API](#http-api)
- [Limits](#limits)

## Setup

- Vide must be **running**; the API is embedded in the desktop app.
- The API binds to `127.0.0.1:17321` and is **not reachable from other machines**.
- Every endpoint except `/health` needs the bearer token that the app generates on first launch.

### Install the CLI

From a checkout of this repo:

```bash
npm link
```

That puts `vide` on your `PATH`. Without linking, use `npm run agent -- <command>` from the repo.

### Token

The CLI finds the token automatically. It lives in the app config directory:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\com.danrave.vibedeck\agent.json` |
| macOS | `~/Library/Application Support/com.danrave.vibedeck/agent.json` |
| Linux | `$XDG_CONFIG_HOME/com.danrave.vibedeck/agent.json` (default `~/.config/...`) |

The folder keeps its original `vibedeck` identifier so existing installs keep their settings.

```json
{ "port": 17321, "token": "aBcDeFgHiJkLmNoPqRsTuVwX" }
```

### Environment variables

`VIDE_AGENT_PORT` and `VIDE_AGENT_TOKEN` override the port and token. The older `VIBEDECK_*` names still work.

- **CLI side:** they replace what the CLI reads from `agent.json`.
- **App side:** they are only used when the app *creates* `agent.json` on first launch. Once the file exists it wins, so to change the port or token later, edit `agent.json` and restart Vide. Setting `VIDE_AGENT_TOKEN` only for the CLI, with a different token in `agent.json`, gives `401 unauthorized`.

## CLI

Every command prints JSON. Exit code `0` is success, `1` is a request error, `2` means Vide is not running.

```bash
vide health                         # is the app up? (no token needed)
vide describe                       # machine-readable route list

vide open "C:\projects\my-monorepo" # open a workspace
vide repos                          # repos in the open workspace
vide select "my-app"                # select a repo in the sidebar
vide view repo --tab changes        # switch view (or: vide view code)
vide show src/App.tsx:42            # open a file in the Code view at line 42

vide git-status                     # defaults to the current directory
vide diff --file src/App.tsx        # working-tree diff (add --staged for the index)

vide configs "C:\projects\my-app"   # detected run configs
vide run --name dev --command "npm run dev" --cwd "C:\projects\my-app"
vide runs                           # running session ids
vide output "C:\projects\my-app::dev" --tail 50
vide stop "C:\projects\my-app::dev"
vide group-run "Backend"            # run a favorites group

vide agents                         # agent CLIs found on PATH
vide launch claude                  # new terminal tab running Claude Code here
vide launch codex --cwd ../api
vide terminal --command "npm test"  # new terminal tab running any command
vide notify "Refactor done, tests green" --level success --repo
```

`--repo` with no value on `notify` means "the current directory", so the notification's **Review changes** button opens this repo.

## Hook recipes

### Claude Code

Add to `.claude/settings.json` (project) or `~/.claude/settings.json` (everywhere):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "vide notify \"Claude finished\" --title \"Claude Code\" --level success --repo" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "vide notify \"Claude is waiting for you\" --title \"Claude Code\" --level warning --repo" }] }
    ]
  }
}
```

Hooks run in the project directory, so `--repo` points at the right repository.

### Codex CLI

Codex runs a program after each turn via `notify` in `~/.codex/config.toml`:

```toml
notify = ["vide", "notify", "--message", "Codex turn finished", "--title", "Codex", "--level", "success", "--repo", "."]
```

Codex appends a JSON payload as the last argument; keeping every value behind a flag means the CLI ignores it.

### Anything else

Any agent that can run a shell command at the end of a task can call `vide notify`. Agents without hooks can be told in their instructions file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`):

```md
When you finish a task, run `vide notify "<one-line summary>" --level success --repo`.
To point me at code, run `vide show <file>:<line>`.
To check a dev server, use `vide runs` and `vide output "<id>" --tail 80` instead of starting a second copy.
```

## HTTP API

JSON in, JSON out, with the header `Authorization: Bearer <token>`. `GET /v1` returns the route list below in machine-readable form.

Routes that act on the UI (open, select, view, run, stop, group run, terminal, notify and file open) behave like this:

- They answer `{"ok": true, "queued": false}` once the action has been handed to a window.
- If no window is listening yet, because Vide is still starting or the page is reloading, the action is held and replayed when a window is ready. The response then says `"queued": true`.
- With several windows open, the action goes to the focused one.

| Method | Path | Input | Does |
| --- | --- | --- | --- |
| GET | `/health` | | `{"status":"ok","app":"vide"}`, no auth |
| GET | `/v1` | | Route list |
| GET | `/v1/status` | | Workspace root and persisted state |
| GET | `/v1/repos` | | Repos in the open workspace |
| POST | `/v1/workspace/open` | `{ path }` | Open a workspace folder |
| POST | `/v1/repo/select` | `{ path }` or `{ name }` | Select a repo |
| POST | `/v1/view` | `{ view, tab? }` | Switch view (`repo`/`favorites`/`sync`/`code`) and tab |
| POST | `/v1/file/open` | `{ path, line? }` | Open a file (absolute path) in the Code view at a line |
| GET | `/v1/git/status` | `?repo=` | Branch, ahead/behind, changed files |
| GET | `/v1/git/diff` | `?repo=&file=&staged=` | Unified diff |
| GET | `/v1/configs` | `?repo=` | Detected run configs |
| POST | `/v1/run` | `{ name, command, cwd, repoPath? }` | Start a run; returns its `id` |
| POST | `/v1/run/stop` | `{ id }` | Stop a run |
| GET | `/v1/runs` | | Running session ids |
| GET | `/v1/runs/output` | `?id=&tail=` | Last N output lines |
| POST | `/v1/group/run` | `{ name }` | Run a favorites group |
| GET | `/v1/agents` | | Agent CLIs found on `PATH` |
| POST | `/v1/terminal/open` | `{ cwd, agent?, command?, title? }` | Open a terminal tab, optionally launching an agent or command |
| POST | `/v1/notify` | `{ message, title?, level?, repo? }` | Show a notification (`info`/`success`/`warning`/`error`) |

Example:

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"message":"Build is green","level":"success"}' \
     http://127.0.0.1:17321/v1/notify
```

## Limits

- **Localhost only.** Cloud agents need a local bridge to reach the API.
- **The app must be running.**
- **Git is read-only over the API.** Agents can read status and diffs; committing and pushing stay with you (or the agent's own git).
- **No terminal input over the API.** Terminals opened via the API are for you to watch and type into.
