import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { configPaths } from "./agent.mjs";

// The app writes agent.json to Tauri's app_config_dir: <config dir>/<bundle identifier>.
test("windows token lives in roaming APPDATA under the bundle identifier", () => {
  const [p] = configPaths({ APPDATA: "C:\Users\me\AppData\Roaming" }, "win32");
  assert.equal(p, join("C:\Users\me\AppData\Roaming", "com.danrave.vibedeck", "agent.json"));
});

test("macOS token lives in Application Support", () => {
  const [p] = configPaths({ HOME: "/Users/me" }, "darwin");
  assert.equal(p, join("/Users/me", "Library", "Application Support", "com.danrave.vibedeck", "agent.json"));
});

test("linux honours XDG_CONFIG_HOME", () => {
  assert.equal(configPaths({ HOME: "/home/me" }, "linux")[0], join("/home/me", ".config", "com.danrave.vibedeck", "agent.json"));
  assert.equal(configPaths({ HOME: "/home/me", XDG_CONFIG_HOME: "/xdg" }, "linux")[0], join("/xdg", "com.danrave.vibedeck", "agent.json"));
});
