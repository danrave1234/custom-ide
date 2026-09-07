import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkVersions, normalizeVersion, synchronizeVersions } from "./version.mjs";

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "vibedeck-version-"));
  await mkdir(join(root, "src-tauri"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "vibedeck", version: "0.1.0" }, null, 2) + "\n"
  );
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify(
      {
        name: "vibedeck",
        version: "0.1.0",
        lockfileVersion: 3,
        packages: { "": { name: "vibedeck", version: "0.1.0" } },
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(
    join(root, "src-tauri", "tauri.conf.json"),
    JSON.stringify({ productName: "VibeDeck", version: "0.1.0" }, null, 2) + "\n"
  );
  await writeFile(
    join(root, "src-tauri", "Cargo.toml"),
    '[package]\nname = "vibedeck"\nversion = "0.1.0"\n\n[dependencies]\n'
  );
  await writeFile(
    join(root, "src-tauri", "Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "other"\nversion = "9.0.0"\n\n[[package]]\nname = "vibedeck"\nversion = "0.1.0"\n'
  );
  return root;
}

test("normalizes stable and prerelease SemVer tags", () => {
  assert.equal(normalizeVersion("1.2.3"), "1.2.3");
  assert.equal(normalizeVersion("v2.0.0-beta.4"), "2.0.0-beta.4");
});

test("rejects incomplete and malformed versions", () => {
  for (const version of ["1.2", "01.2.3", "1.2.3.4", "release-1.2.3", "1.2.3-"]) {
    assert.throws(() => normalizeVersion(version), /valid SemVer/);
  }
});

test("synchronizes every application manifest without touching dependencies", async (t) => {
  const root = await createProject();
  t.after(() => rm(root, { recursive: true, force: true }));

  await synchronizeVersions(root, "v0.2.0-beta.1");
  assert.equal(await checkVersions(root), "0.2.0-beta.1");

  const cargoLock = await readFile(join(root, "src-tauri", "Cargo.lock"), "utf8");
  assert.match(cargoLock, /name = "other"\nversion = "9\.0\.0"/);
  assert.match(cargoLock, /name = "vibedeck"\nversion = "0\.2\.0-beta\.1"/);
});

test("reports mismatched manifests", async (t) => {
  const root = await createProject();
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.version = "0.2.0";
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

  await assert.rejects(() => checkVersions(root), /Version mismatch/);
});