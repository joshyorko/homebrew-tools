#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

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

function readPnpmWorkspaceCatalog(path) {
  if (!existsSync(path)) return {};

  const catalog = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const catalogStart = lines.findIndex((line) => line === "catalog:");
  if (catalogStart === -1) return catalog;

  for (const line of lines.slice(catalogStart + 1)) {
    if (/^\S/.test(line)) break;

    const match = line.match(/^  (?:"([^"]+)"|([^:]+)):\s+(.+)$/);
    if (!match) continue;

    const name = match[1] ?? match[2].trim();
    const version = match[3].trim().replace(/^"(.+)"$/, "$1");
    catalog[name] = version;
  }

  return catalog;
}

function resolveCatalogDependencies(dependencies, catalog) {
  const resolved = {};

  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (version === "catalog:") {
      const resolvedVersion = catalog?.[name];
      if (!resolvedVersion) {
        throw new Error(`Missing catalog version for dependency "${name}"`);
      }

      resolved[name] = resolvedVersion;
      continue;
    }

    resolved[name] = version;
  }

  return resolved;
}

function normalizeBinEntry(binEntry) {
  if (typeof binEntry !== "string" || binEntry.length === 0) {
    throw new Error('Expected apps/server/package.json to define a string bin entry for "t3"');
  }

  return binEntry.startsWith("./") ? binEntry.slice(2) : binEntry;
}

function main() {
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
  const pnpmWorkspaceCatalog = readPnpmWorkspaceCatalog(join(upstreamDir, "pnpm-workspace.yaml"));
  const serverPackageJson = readJson(join(upstreamDir, "apps/server/package.json"));
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
    dependencies: resolveCatalogDependencies(
      serverPackageJson.dependencies,
      {
        ...rootPackageJson.workspaces?.catalog,
        ...pnpmWorkspaceCatalog,
      },
    ),
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

  mkdirSync(dirname(outputPath), { recursive: true });
  execFileSync("tar", ["-czf", outputPath, "-C", packageDir, "."], {
    stdio: "inherit",
  });

  rmSync(stageRoot, { recursive: true, force: true });
  console.log(outputPath);
}

main();
