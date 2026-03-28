#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRpmArg = args["source-rpm"];
  const outputPathArg = args.output;

  if (!sourceRpmArg || !outputPathArg) {
    throw new Error(
      "Usage: package-vscode-insiders-linux.mjs --source-rpm <rpm> --output <tar.gz>",
    );
  }

  const sourceRpm = resolve(sourceRpmArg);
  const outputPath = resolve(outputPathArg);

  const stageRoot = mkdtempSync(join(tmpdir(), "vscode-insiders-linux-"));
  const packageDir = join(stageRoot, "package");
  const requiredPaths = [
    "usr/share/code-insiders/bin/code-insiders",
    "usr/share/code-insiders/bin/code-tunnel-insiders",
    "usr/share/code-insiders/code-insiders",
    "usr/share/applications/code-insiders.desktop",
    "usr/share/applications/code-insiders-url-handler.desktop",
    "usr/share/mime/packages/code-insiders-workspace.xml",
    "usr/share/code-insiders/resources/app/package.json",
  ];

  try {
    mkdirSync(packageDir, { recursive: true });

    execFileSync(
      "bash",
      [
        "-lc",
        "set -euo pipefail; rpm2cpio \"$1\" | cpio -idm --quiet",
        "bash",
        sourceRpm,
      ],
      {
        cwd: packageDir,
        stdio: "inherit",
      },
    );

    for (const requiredPath of requiredPaths) {
      const absolutePath = join(packageDir, requiredPath);
      if (!existsSync(absolutePath)) {
        throw new Error(`Missing required upstream file at ${absolutePath}`);
      }
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
