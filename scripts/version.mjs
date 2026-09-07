import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const JSON_FILES = ["package.json", "package-lock.json", join("src-tauri", "tauri.conf.json")];

export function normalizeVersion(input) {
  const version = input?.trim().replace(/^v/, "");
  if (!version || !SEMVER_PATTERN.test(version)) {
    throw new Error(`\`${input ?? ""}\` is not a valid SemVer version (for example: 1.2.3 or 2.0.0-beta.1)`);
  }
  return version;
}

function packageSectionVersion(toml) {
  const section = toml.match(/^\[package]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  const version = section?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error("Could not read [package].version from src-tauri/Cargo.toml");
  return version;
}

function lockPackageVersion(lock) {
  const blocks = lock.split(/(?=^\[\[package]]\s*$)/m);
  const block = blocks.find((candidate) => /^name\s*=\s*"vibedeck"\s*$/m.test(candidate));
  const version = block?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error("Could not read the vibedeck package version from src-tauri/Cargo.lock");
  return version;
}

function replacePackageSectionVersion(toml, version) {
  const sectionPattern = /(^\[package]\s*$[\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m;
  if (!sectionPattern.test(toml)) throw new Error("Could not update [package].version in src-tauri/Cargo.toml");
  return toml.replace(sectionPattern, `$1${version}$2`);
}

function replaceLockPackageVersion(lock, version) {
  const blocks = lock.split(/(?=^\[\[package]]\s*$)/m);
  const index = blocks.findIndex((candidate) => /^name\s*=\s*"vibedeck"\s*$/m.test(candidate));
  if (index < 0 || !/^version\s*=\s*"[^"]+"\s*$/m.test(blocks[index])) {
    throw new Error("Could not update the vibedeck package version in src-tauri/Cargo.lock");
  }
  blocks[index] = blocks[index].replace(
    /(^version\s*=\s*")[^"]+("\s*$)/m,
    `$1${version}$2`
  );
  return blocks.join("");
}

async function readManifests(root) {
  const [packageText, lockText, tauriText, cargoText, cargoLockText] = await Promise.all([
    ...JSON_FILES.map((file) => readFile(join(root, file), "utf8")),
    readFile(join(root, "src-tauri", "Cargo.toml"), "utf8"),
    readFile(join(root, "src-tauri", "Cargo.lock"), "utf8"),
  ]);
  return {
    packageText,
    packageLockText: lockText,
    tauriText,
    cargoText,
    cargoLockText,
    packageJson: JSON.parse(packageText),
    packageLock: JSON.parse(lockText),
    tauriConfig: JSON.parse(tauriText),
  };
}

export async function checkVersions(root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), expected) {
  const manifests = await readManifests(root);
  const versions = new Map([
    ["package.json", manifests.packageJson.version],
    ["package-lock.json", manifests.packageLock.version],
    ["package-lock.json packages root", manifests.packageLock.packages?.[""]?.version],
    ["src-tauri/tauri.conf.json", manifests.tauriConfig.version],
    ["src-tauri/Cargo.toml", packageSectionVersion(manifests.cargoText)],
    ["src-tauri/Cargo.lock", lockPackageVersion(manifests.cargoLockText)],
  ]);
  const canonical = expected ? normalizeVersion(expected) : versions.values().next().value;
  const mismatches = [...versions].filter(([, version]) => version !== canonical);
  if (mismatches.length > 0) {
    const details = [...versions].map(([file, version]) => `  ${file}: ${version ?? "missing"}`).join("\n");
    throw new Error(`Version mismatch; expected ${canonical}:\n${details}`);
  }
  return canonical;
}

export async function synchronizeVersions(
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  input
) {
  const version = normalizeVersion(input);
  const manifests = await readManifests(root);

  manifests.packageJson.version = version;
  manifests.packageLock.version = version;
  if (!manifests.packageLock.packages?.[""]) {
    throw new Error("Could not update the root package in package-lock.json");
  }
  manifests.packageLock.packages[""].version = version;
  manifests.tauriConfig.version = version;

  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify(manifests.packageJson, null, 2) + "\n"),
    writeFile(join(root, "package-lock.json"), JSON.stringify(manifests.packageLock, null, 2) + "\n"),
    writeFile(
      join(root, "src-tauri", "tauri.conf.json"),
      JSON.stringify(manifests.tauriConfig, null, 2) + "\n"
    ),
    writeFile(
      join(root, "src-tauri", "Cargo.toml"),
      replacePackageSectionVersion(manifests.cargoText, version)
    ),
    writeFile(
      join(root, "src-tauri", "Cargo.lock"),
      replaceLockPackageVersion(manifests.cargoLockText, version)
    ),
  ]);
  await checkVersions(root, version);
  return version;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, expected] = process.argv.slice(2);
  if (command === "--check") {
    const version = await checkVersions(root, expected);
    console.log(`VibeDeck version ${version} is synchronized.`);
    return;
  }
  if (!command || expected) {
    throw new Error("Usage: npm run version:set -- <version>\n       npm run version:check -- [expected-version]");
  }
  const version = await synchronizeVersions(root, command);
  console.log(`Updated VibeDeck to ${version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}