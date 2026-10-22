#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { applyPnpmPackagePatch } from "./lib/apply-pnpm-package-patch.mjs";

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPnpmWorkspaceSection(path, sectionName) {
  if (!existsSync(path)) return {};

  const section = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => line === `${sectionName}:`);
  if (sectionStart === -1) return section;

  for (const line of lines.slice(sectionStart + 1)) {
    if (/^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;

    const match = line.match(/^  (?:"([^"]+)"|([^:]+)):\s+(.+)$/);
    if (!match) continue;

    const name = match[1] ?? match[2].trim();
    const version = match[3].trim().replace(/^(["'])(.+)\1$/, "$2");
    section[name] = version;
  }

  return section;
}

function readPnpmPackageVersion(path, packageName, requestedVersion) {
  if (!existsSync(path)) return undefined;

  const packagePrefix = `${packageName}@`;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^  (?:"([^"]+)"|'([^']+)'|([^:]+)):\s*$/);
    const key = match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
    if (requestedVersion) {
      if (key === `${packagePrefix}${requestedVersion}`) return requestedVersion;
    } else if (key?.startsWith(packagePrefix)) {
      return key.slice(packagePrefix.length);
    }
  }
}

function resolveCatalogDependencies(dependencies, catalog) {
  const resolved = {};

  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (typeof version === "string" && version.startsWith("catalog:")) {
      const selector = name.split(">").at(-1) ?? name;
      const versionIndex = selector.indexOf("@", 1);
      const packageName = versionIndex === -1 ? selector : selector.slice(0, versionIndex);
      const catalogKey = version.slice("catalog:".length).trim() || packageName;
      const resolvedVersion = catalog?.[catalogKey];
      if (!resolvedVersion) {
        throw new Error(`Missing catalog version for dependency "${name}" (catalog key "${catalogKey}")`);
      }

      resolved[name] = resolvedVersion;
      continue;
    }

    resolved[name] = version;
  }

  return resolved;
}

function npmOverridesFromPnpm(overrides) {
  const npmOverrides = {};

  for (const [selector, version] of Object.entries(overrides)) {
    if (version === "-") continue;

    const parts = selector.split(">");
    let target = npmOverrides;
    for (const part of parts.slice(0, -1)) {
      const existing = target[part];
      if (!existing || typeof existing !== "object") {
        target[part] = existing === undefined ? {} : { ".": existing };
      }
      target = target[part];
    }

    const finalPart = parts.at(-1);
    const existing = target[finalPart];
    target[finalPart] = existing && typeof existing === "object"
      ? { ...existing, ".": version }
      : version;
  }

  return npmOverrides;
}

function normalizeBinEntry(binEntry) {
  if (typeof binEntry !== "string" || binEntry.length === 0) {
    throw new Error('Expected apps/server/package.json to define a string bin entry for "t3"');
  }

  return binEntry.startsWith("./") ? binEntry.slice(2) : binEntry;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const upstreamDirArg = args["upstream-dir"];
  const version = args.version;
  const outputPathArg = args.output;

  if (!upstreamDirArg || !version || !outputPathArg) {
    throw new Error("Usage: package-t3code-cli-main.mjs --upstream-dir <dir> --version <version> --output <tar.gz>");
  }

  const upstreamDir = resolve(upstreamDirArg);
  const outputPath = resolve(outputPathArg);

  const rootPackageJson = readJson(join(upstreamDir, "package.json"));
  const workspacePath = join(upstreamDir, "pnpm-workspace.yaml");
  const lockfilePath = join(upstreamDir, "pnpm-lock.yaml");
  const pnpmWorkspaceCatalog = readPnpmWorkspaceSection(workspacePath, "catalog");
  const pnpmWorkspaceOverrides = readPnpmWorkspaceSection(workspacePath, "overrides");
  const pnpmWorkspacePatches = readPnpmWorkspaceSection(workspacePath, "patchedDependencies");
  const pinnedPlatformNodeSharedVersion = readPnpmPackageVersion(lockfilePath, "@effect/platform-node-shared");
  const serverPackageJson = readJson(join(upstreamDir, "apps/server/package.json"));
  const { selectCliRuntimeExternalDependencies } = await import(
    pathToFileURL(join(upstreamDir, "scripts/lib/cli-external-packages.ts")).href
  );
  const catalog = {
    ...rootPackageJson.workspaces?.catalog,
    ...pnpmWorkspaceCatalog,
  };
  const npmWorkspaceOverrides = npmOverridesFromPnpm(
    resolveCatalogDependencies(pnpmWorkspaceOverrides, catalog),
  );
  const runtimeDependencies = selectCliRuntimeExternalDependencies(
    resolveCatalogDependencies(serverPackageJson.dependencies, catalog),
  );
  for (const [name, version] of Object.entries(runtimeDependencies)) {
    if (version.startsWith("workspace:")) {
      throw new Error(`Upstream CLI external dependency "${name}" is unresolved: ${version}`);
    }
  }
  for (const patchedPackage of Object.keys(pnpmWorkspacePatches)) {
    const separator = patchedPackage.lastIndexOf("@");
    const packageName = patchedPackage.slice(0, separator);
    const patchVersion = patchedPackage.slice(separator + 1);
    if (!Object.hasOwn(runtimeDependencies, packageName)) continue;

    const lockedVersion = readPnpmPackageVersion(lockfilePath, packageName, patchVersion);
    if (lockedVersion !== patchVersion) {
      throw new Error(
        `Expected pnpm lockfile to pin patched external ${packageName}@${patchVersion}; got ${lockedVersion ?? "none"}`,
      );
    }
    runtimeDependencies[packageName] = lockedVersion;
  }
  const licensePath = join(upstreamDir, "LICENSE");
  const readmePath = join(upstreamDir, "README.md");
  const distDir = join(upstreamDir, "apps/server/dist");
  const cliEntryRelativePath = normalizeBinEntry(serverPackageJson.bin?.t3);
  const cliEntry = join(upstreamDir, "apps/server", cliEntryRelativePath);
  const bundledClientEntry = join(distDir, "client/index.html");

  if (!existsSync(cliEntry)) {
    throw new Error(`Missing CLI entrypoint at ${cliEntry}`);
  }

  if (!existsSync(bundledClientEntry)) {
    throw new Error(`Missing bundled client at ${bundledClientEntry}`);
  }

  const stageRoot = mkdtempSync(join(tmpdir(), "t3code-cli-main-"));
  const packageDir = join(stageRoot, "package");
  mkdirSync(packageDir, { recursive: true });

  const runtimePackageJson = {
    name: "t3code-cli-main",
    version,
    description: serverPackageJson.description ?? "T3 Code CLI built from pingdotgg/t3code main",
    homepage: "https://github.com/pingdotgg/t3code",
    repository: serverPackageJson.repository,
    license: "MIT",
    type: "module",
    bin: {
      t3: `./${cliEntryRelativePath}`,
    },
    files: ["dist"],
    engines: serverPackageJson.engines,
    ...(pinnedPlatformNodeSharedVersion || Object.keys(npmWorkspaceOverrides).length > 0
      ? {
          overrides: {
            ...npmWorkspaceOverrides,
            ...(pinnedPlatformNodeSharedVersion
              ? { "@effect/platform-node-shared": pinnedPlatformNodeSharedVersion }
              : {}),
          },
        }
      : {}),
    dependencies: runtimeDependencies,
  };

  cpSync(distDir, join(packageDir, "dist"), { recursive: true });
  cpSync(licensePath, join(packageDir, "LICENSE"));
  cpSync(readmePath, join(packageDir, "README.md"));
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify(runtimePackageJson, null, 2)}\n`);

  execFileSync("npm", ["install", "--package-lock-only"], {
    cwd: packageDir,
    stdio: "inherit",
  });

  execFileSync("npm", ["ci", "--omit=dev"], {
    cwd: packageDir,
    stdio: "inherit",
  });

  for (const patchedPackage of Object.keys(pnpmWorkspacePatches)) {
    const separator = patchedPackage.lastIndexOf("@");
    const packageName = patchedPackage.slice(0, separator);
    const version = patchedPackage.slice(separator + 1);
    if (runtimeDependencies[packageName] !== version) continue;
    applyPnpmPackagePatch(upstreamDir, join(packageDir, "node_modules"), packageName, version);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  execFileSync("tar", ["-czf", outputPath, "-C", packageDir, "."], {
    stdio: "inherit",
  });

  rmSync(stageRoot, { recursive: true, force: true });
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
