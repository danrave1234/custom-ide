#!/usr/bin/env node
/**
 * Vide CLI
 *
 * Control a running Vide instance from a terminal, a script, or a coding
 * agent (Claude Code, Codex, Gemini CLI, ...). Every command prints JSON.
 *
 * Usage: vide <command> [args]   (or: npm run agent -- <command> [args])
 * Run `vide help` for the command list.
 */

import { readFileSync, existsSync, realpathSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tauri's app_config_dir is <platform config dir>/<bundle identifier>.
// The identifier stays com.danrave.vibedeck so existing installs keep their data.
const APP_IDENTIFIER = "com.danrave.vibedeck";

export function configPaths(env = process.env, platform = process.platform) {
  const { HOME, APPDATA, XDG_CONFIG_HOME } = env;
  if (platform === "win32") return [join(APPDATA || "", APP_IDENTIFIER, "agent.json")];
  if (platform === "darwin") {
    return [join(HOME || "", "Library", "Application Support", APP_IDENTIFIER, "agent.json")];
  }
  return [join(XDG_CONFIG_HOME || join(HOME || "", ".config"), APP_IDENTIFIER, "agent.json")];
}

// Find agent config
function findConfig() {
  // Check environment variables first
  const port = process.env.VIDE_AGENT_PORT || process.env.VIBEDECK_AGENT_PORT || "17321";
  const token = process.env.VIDE_AGENT_TOKEN || process.env.VIBEDECK_AGENT_TOKEN;
  if (token) return { port: Number(port), token };

  const possiblePaths = configPaths();

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        const cfg = JSON.parse(readFileSync(path, "utf-8"));
        return { port: cfg.port || Number(port), token: cfg.token };
      } catch {
        // continue
      }
    }
  }

  // Fallback: default port, no token (will fail auth but health works)
  return { port: Number(port), token: null };
}

async function request(config, method, path, body) {
  const url = `http://127.0.0.1:${config.port}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  const init = { method, headers };
  if (body) {
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch {
    console.error(`Error: cannot connect to Vide on port ${config.port}. Is the app running?`);
    process.exit(2);
  }
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      console.error(`Error: unauthorized. Set VIDE_AGENT_TOKEN or check ${configPaths()[0]}.`);
    } else {
      console.error(`Error: ${data.error || res.statusText}`);
    }
    process.exit(1);
  }

  return data;
}

function parseArgs(args) {
  const result = { cmd: null, args: [], opts: {} };
  let i = 0;

  // First non-flag arg is the command
  for (; i < args.length; i++) {
    if (args[i].startsWith("--")) break;
    if (!result.cmd) {
      result.cmd = args[i];
    } else {
      result.args.push(args[i]);
    }
  }

  // Parse flags
  for (; i < args.length; i++) {
    if (args[i].startsWith("--") && args[i].includes("=")) {
      const [key, ...valParts] = args[i].slice(2).split("=");
      result.opts[key] = valParts.join("=");
    } else if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result.opts[key] = next;
        i++;
      } else {
        result.opts[key] = true;
      }
    }
  }

  return result;
}

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main() {
  const raw = process.argv.slice(2);

  // Handle -- separator: node scripts/agent.mjs -- open "path"
  const args = raw.includes("--") ? raw.slice(raw.indexOf("--") + 1) : raw;
  const parsed = parseArgs(args);

  if (!parsed.cmd || parsed.cmd === "help" || parsed.cmd === "-h" || parsed.cmd === "--help") {
    console.log(`Vide CLI — drive the Vide desktop app from a terminal or coding agent.
All commands print JSON. Exit codes: 0 ok, 1 request error, 2 app not running.

Workspace
  health                          Check that Vide is running (no token needed)
  describe                        Machine-readable list of API routes
  status                          Current workspace root and persisted state
  open "<path>"                   Open a workspace folder
  repos                           List repos in the open workspace
  select "<name>" | --path <p>    Select a repo in the sidebar
  view <repo|favorites|sync|code> [--tab changes|branches|history|run|env]
  show "<file>[:line]"            Open a file in the Code view, scrolled to the line

Git (read-only)
  git-status "<repo>"             Branch, ahead/behind, changed files
  diff "<repo>" [--file f] [--staged]   Unified diff of working changes

Runs
  configs "<repo>"                Detected run configs (npm scripts, cargo, ...)
  run --name <n> --command <c> --cwd <d> [--repo <r>]
  stop "<session-id>"             Stop a run (id is "<repo>::<name>")
  runs                            Running session ids
  output "<id>" [--tail N]        Last N lines of a run's output
  group-run "<name>"              Run a favorites group

Agents
  agents                          Coding-agent CLIs found on PATH
  launch <agent> [--cwd <dir>]    Open a terminal tab running claude/codex/gemini/...
  terminal [--cwd <dir>] [--command <c>] [--title <t>]
  notify "<message>" [--title t] [--level info|success|warning|error] [--repo <path>]

Environment
  VIDE_AGENT_PORT    Override default port (17321)
  VIDE_AGENT_TOKEN   Override auth token (VIBEDECK_* names still work)
`);
    return;
  }

  const config = findConfig();

  switch (parsed.cmd) {
    case "health": {
      const data = await request(config, "GET", "/health");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "describe": {
      print(await request(config, "GET", "/v1"));
      break;
    }

    case "repos": {
      print(await request(config, "GET", "/v1/repos"));
      break;
    }

    case "git-status":
    case "diff": {
      const repo = parsed.args[0] || parsed.opts.repo || process.cwd();
      const q = new URLSearchParams({ repo });
      if (parsed.cmd === "diff") {
        if (parsed.opts.file) q.set("file", parsed.opts.file);
        if (parsed.opts.staged) q.set("staged", "1");
      }
      const route = parsed.cmd === "diff" ? "/v1/git/diff" : "/v1/git/status";
      print(await request(config, "GET", `${route}?${q}`));
      break;
    }

    case "show": {
      const spec = parsed.args[0] || parsed.opts.file;
      if (!spec) fail('file is required. Usage: vide show "src/App.tsx:42"');
      // accept path:line, but leave Windows drive letters ("C:\x") alone
      const m = spec.match(/^(.*?):(\d+)$/);
      const file = resolve(m ? m[1] : spec);
      const line = m ? Number(m[2]) : parsed.opts.line ? Number(parsed.opts.line) : undefined;
      print(await request(config, "POST", "/v1/file/open", { path: file, line }));
      break;
    }

    case "agents": {
      print(await request(config, "GET", "/v1/agents"));
      break;
    }

    case "launch": {
      const agent = parsed.args[0] || parsed.opts.agent;
      if (!agent) fail('agent is required. Usage: vide launch <claude|codex|gemini|...> [--cwd <dir>]');
      const cwd = parsed.opts.cwd || process.cwd();
      print(await request(config, "POST", "/v1/terminal/open", { cwd, agent, title: parsed.opts.title }));
      break;
    }

    case "terminal": {
      const body = {
        cwd: parsed.opts.cwd || process.cwd(),
        command: parsed.opts.command || parsed.opts.cmd,
        title: parsed.opts.title,
      };
      print(await request(config, "POST", "/v1/terminal/open", body));
      break;
    }

    case "notify": {
      const message = parsed.args.join(" ") || parsed.opts.message;
      if (!message) fail('message is required. Usage: vide notify "<message>"');
      const body = {
        message,
        title: parsed.opts.title,
        level: parsed.opts.level,
        repo: parsed.opts.repo === true ? process.cwd() : parsed.opts.repo && resolve(parsed.opts.repo),
      };
      print(await request(config, "POST", "/v1/notify", body));
      break;
    }

    case "status": {
      const data = await request(config, "GET", "/v1/status");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "open": {
      const path = parsed.args[0] || parsed.opts.path;
      if (!path) {
        console.error("Error: path is required. Usage: agent open \"<path>\"");
        process.exit(1);
      }
      const data = await request(config, "POST", "/v1/workspace/open", { path });
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "select": {
      const name = parsed.args[0];
      const body = name ? { name } : { path: parsed.opts.path };
      if (!body.name && !body.path) {
        console.error("Error: name or --path is required. Usage: agent select \"<name>\"");
        process.exit(1);
      }
      const data = await request(config, "POST", "/v1/repo/select", body);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "configs": {
      const repo = parsed.args[0] || parsed.opts.repo;
      if (!repo) {
        console.error("Error: repo path is required. Usage: agent configs \"<repo-path>\"");
        process.exit(1);
      }
      const data = await request(config, "GET", `/v1/configs?repo=${encodeURIComponent(repo)}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "run": {
      const body = {
        name: parsed.opts.name || parsed.opts.n,
        command: parsed.opts.command || parsed.opts.cmd || parsed.opts.c,
        cwd: parsed.opts.cwd || parsed.opts.d,
        repoPath: parsed.opts.repo,
      };
      if (!body.name || !body.command || !body.cwd) {
        console.error("Error: --name, --command, and --cwd are required.");
        process.exit(1);
      }
      const data = await request(config, "POST", "/v1/run", body);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "stop": {
      const id = parsed.args[0] || parsed.opts.id;
      if (!id) {
        console.error("Error: session id is required. Usage: agent stop \"<id>\"");
        process.exit(1);
      }
      const data = await request(config, "POST", "/v1/run/stop", { id });
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "runs": {
      const data = await request(config, "GET", "/v1/runs");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "output": {
      const id = parsed.args[0] || parsed.opts.id;
      if (!id) {
        console.error("Error: session id is required. Usage: agent output \"<id>\"");
        process.exit(1);
      }
      const tail = parsed.opts.tail ? Number(parsed.opts.tail) : 100;
      const data = await request(config, "GET", `/v1/runs/output?id=${encodeURIComponent(id)}&tail=${tail}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "view": {
      const view = parsed.args[0] || parsed.opts.view;
      if (!view) {
        console.error("Error: view is required. Usage: agent view <repo|favorites|sync>");
        process.exit(1);
      }
      const body = { view, tab: parsed.opts.tab || undefined };
      const data = await request(config, "POST", "/v1/view", body);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "group-run": {
      const name = parsed.args[0] || parsed.opts.name;
      if (!name) {
        console.error("Error: group name is required. Usage: agent group-run \"<name>\"");
        process.exit(1);
      }
      const data = await request(config, "POST", "/v1/group/run", { name });
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${parsed.cmd}`);
      console.error("Run 'vide help' for usage.");
      process.exit(1);
  }
}

// only run when executed directly, so tests can import configPaths()
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
  });
}
