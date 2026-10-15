#!/usr/bin/env node
/**
 * VibeDeck Agent CLI
 *
 * Control a running VibeDeck instance from the terminal.
 * Requires VibeDeck to be running with the agent API enabled (default).
 *
 * Usage:
 *   node scripts/agent.mjs health
 *   node scripts/agent.mjs status
 *   node scripts/agent.mjs open "C:\projects\my-app"
 *   node scripts/agent.mjs select "my-repo"
 *   node scripts/agent.mjs select --path "C:\projects\my-repo"
 *   node scripts/agent.mjs configs "C:\projects\my-repo"
 *   node scripts/agent.mjs run --name "dev" --command "npm run dev" --cwd "C:\projects\my-app"
 *   node scripts/agent.mjs stop "<session-id>"
 *   node scripts/agent.mjs runs
 *   node scripts/agent.mjs output "<session-id>" [--tail 50]
 *   node scripts/agent.mjs view favorites
 *   node scripts/agent.mjs view repo --tab run
 *   node scripts/agent.mjs group-run "Backend"
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find agent config
function findConfig() {
  // Check environment variables first
  const port = process.env.VIBEDECK_AGENT_PORT || "17321";
  const token = process.env.VIBEDECK_AGENT_TOKEN;
  if (token) return { port: Number(port), token };

  // Try app config directory (platform-specific)
  const possiblePaths = [];
  const { HOME, APPDATA, LOCALAPPDATA } = process.env;

  if (process.platform === "win32") {
    possiblePaths.push(join(LOCALAPPDATA || "", "vibedeck", "agent.json"));
  } else if (process.platform === "darwin") {
    possiblePaths.push(join(HOME || "", "Library", "Application Support", "vibedeck", "agent.json"));
  } else {
    possiblePaths.push(join(HOME || "", ".config", "vibedeck", "agent.json"));
  }

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

  const res = await fetch(url, init);
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) {
      console.error("Error: unauthorized. Set VIBEDECK_AGENT_TOKEN or check agent.json.");
    } else if (res.status === 503 || res.status === 0) {
      console.error("Error: cannot connect to VibeDeck. Is it running?");
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

async function main() {
  const raw = process.argv.slice(2);

  // Handle -- separator: node scripts/agent.mjs -- open "path"
  const args = raw.includes("--") ? raw.slice(raw.indexOf("--") + 1) : raw;
  const parsed = parseArgs(args);

  if (!parsed.cmd || parsed.cmd === "help" || parsed.cmd === "-h" || parsed.cmd === "--help") {
    console.log(`VibeDeck Agent CLI

Usage:
  agent health                    Check if VibeDeck agent is running
  agent status                    Get current workspace status
  agent open "<path>"             Open a workspace folder
  agent select "<name>"           Select a repo by name
  agent select --path "<path>"    Select a repo by path
  agent configs "<repo-path>"     List run configs for a repo
  agent run --name <n> --cmd <c> --cwd <d>  Start a run
  agent stop "<session-id>"       Stop a running session
  agent runs                      List running sessions
  agent output "<id>" [--tail N]  Get session output
  agent view <view> [--tab <t>]   Switch view (repo/favorites/sync)
  agent group-run "<name>"        Run a favorites group

Environment:
  VIBEDECK_AGENT_PORT    Override default port (17321)
  VIBEDECK_AGENT_TOKEN   Override auth token
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
      console.error("Run 'agent help' for usage.");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
