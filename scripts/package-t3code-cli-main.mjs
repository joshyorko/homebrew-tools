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
  const serverPackageJson = readJson(join(upstreamDir, "apps/server/package.json"));
  const licensePath = join(upstreamDir, "LICENSE");
  const readmePath = join(upstreamDir, "README.md");
  const distDir = join(upstreamDir, "apps/server/dist");
  const cliEntry = join(distDir, "index.mjs");
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
      t3: "./dist/index.mjs",
    },
    files: ["dist"],
    engines: serverPackageJson.engines,
    dependencies: resolveCatalogDependencies(
      serverPackageJson.dependencies,
      rootPackageJson.workspaces?.catalog,
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

  mkdirSync(dirname(outputPath), { recursive: true });
  execFileSync("tar", ["-czf", outputPath, "-C", packageDir, "."], {
    stdio: "inherit",
  });

  rmSync(stageRoot, { recursive: true, force: true });
  console.log(outputPath);
}

main();
