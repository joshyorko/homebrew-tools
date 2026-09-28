#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceArchive = args["source-archive"] && resolve(args["source-archive"]);
  const expectedSha256 = args["source-sha256"]?.toLowerCase();
  const outputPath = args.output && resolve(args.output);

  if (!sourceArchive || !expectedSha256 || !outputPath) {
    throw new Error(
      "Usage: package-vscode-insiders-linux.mjs --source-archive <tar.gz> --source-sha256 <sha256> --output <tar.gz>",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("--source-sha256 must contain 64 hexadecimal characters");
  }

  const actualSha256 = await sha256File(sourceArchive);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Microsoft archive SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }

  const stageRoot = mkdtempSync(join(tmpdir(), "vscode-insiders-linux-"));
  const packageDir = join(stageRoot, "package");
  const appDir = join(packageDir, "usr/share/code-insiders");

  try {
    mkdirSync(appDir, { recursive: true });
    execFileSync("tar", ["-xzf", sourceArchive, "--strip-components=1", "-C", appDir], { stdio: "inherit" });

    const requiredPaths = [
      "bin/code-insiders",
      "bin/code-tunnel-insiders",
      "code-insiders",
      "resources/app/package.json",
      "resources/app/resources/linux/code.png",
    ];
    for (const path of requiredPaths) {
      const absolutePath = join(appDir, path);
      if (!existsSync(absolutePath)) {
        throw new Error(`Missing required Microsoft archive file at ${absolutePath}`);
      }
    }

    const packageJsonPath = join(appDir, "resources/app/package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    packageJson.desktopName = "code-insiders.desktop";
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const applicationsDir = join(packageDir, "usr/share/applications");
    const mimeDir = join(packageDir, "usr/share/mime/packages");
    const pixmapsDir = join(packageDir, "usr/share/pixmaps");
    mkdirSync(applicationsDir, { recursive: true });
    mkdirSync(mimeDir, { recursive: true });
    mkdirSync(pixmapsDir, { recursive: true });

    writeFileSync(join(applicationsDir, "code-insiders.desktop"), `[Desktop Entry]
Name=Visual Studio Code - Insiders
Comment=Code Editing. Redefined.
GenericName=Text Editor
Exec=/usr/share/code-insiders/code-insiders %F
Icon=vscode-insiders
Type=Application
StartupNotify=false
StartupWMClass=Code - Insiders
Categories=TextEditor;Development;IDE;
MimeType=application/x-code-insiders-workspace;
Actions=new-empty-window;
Keywords=vscode;

[Desktop Action new-empty-window]
Name=New Empty Window
Exec=/usr/share/code-insiders/code-insiders --new-window %F
Icon=vscode-insiders
`);
    writeFileSync(join(applicationsDir, "code-insiders-url-handler.desktop"), `[Desktop Entry]
Name=Visual Studio Code Insiders - URL Handler
Comment=Code Editing. Redefined.
GenericName=Text Editor
Exec=/usr/share/code-insiders/code-insiders --open-url %U
Icon=vscode-insiders
Type=Application
NoDisplay=true
StartupNotify=true
Categories=Utility;TextEditor;Development;IDE;
MimeType=x-scheme-handler/vscode-insiders;
Keywords=vscode;
`);
    writeFileSync(join(mimeDir, "code-insiders-workspace.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-code-insiders-workspace">
    <comment>Visual Studio Code Insiders Workspace</comment>
    <glob pattern="*.code-workspace"/>
  </mime-type>
</mime-info>
`);
    execFileSync("cp", [join(appDir, "resources/app/resources/linux/code.png"), join(pixmapsDir, "vscode-insiders.png")]);

    mkdirSync(join(outputPath, ".."), { recursive: true });
    execFileSync("tar", [
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
    ], { stdio: "inherit" });

    console.log(outputPath);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
