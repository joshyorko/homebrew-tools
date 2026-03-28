#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceTarballArg = args["source-tarball"];
  const outputPathArg = args.output;

  if (!sourceTarballArg || !outputPathArg) {
    throw new Error(
      "Usage: package-vscode-insiders-linux.mjs --source-tarball <tar.gz> --output <tar.gz>",
    );
  }

  const sourceTarball = resolve(sourceTarballArg);
  const outputPath = resolve(outputPathArg);

  const stageRoot = mkdtempSync(join(tmpdir(), "vscode-insiders-linux-"));
  const packageDir = join(stageRoot, "package");

  try {
    mkdirSync(packageDir, { recursive: true });

    execFileSync("tar", ["-xzf", sourceTarball, "-C", packageDir], {
      stdio: "inherit",
    });

    const appDir = join(packageDir, "VSCode-linux-x64");
    const packageJsonPath = join(appDir, "resources/app/package.json");
    const cliPath = join(appDir, "bin/code-insiders");
    const tunnelCliPath = join(appDir, "bin/code-tunnel-insiders");
    const iconPath = join(appDir, "resources/app/resources/linux/code.png");

    if (!existsSync(appDir)) {
      throw new Error(`Expected extracted app directory at ${appDir}`);
    }

    if (!existsSync(packageJsonPath)) {
      throw new Error(`Missing package metadata at ${packageJsonPath}`);
    }

    if (!existsSync(cliPath)) {
      throw new Error(`Missing CLI launcher at ${cliPath}`);
    }

    if (!existsSync(tunnelCliPath)) {
      throw new Error(`Missing tunnel CLI launcher at ${tunnelCliPath}`);
    }

    if (!existsSync(iconPath)) {
      throw new Error(`Missing Linux icon at ${iconPath}`);
    }

    const packageJson = readJson(packageJsonPath);
    if (!packageJson.version || typeof packageJson.version !== "string") {
      throw new Error(`Missing version in ${packageJsonPath}`);
    }

    execFileSync(
      "tar",
      [
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--use-compress-program=gzip -n",
        "-cf",
        outputPath,
        "-C",
        packageDir,
        ".",
      ],
      {
        stdio: "inherit",
      },
    );

    console.log(outputPath);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

main();
