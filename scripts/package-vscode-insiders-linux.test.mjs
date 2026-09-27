#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./package-vscode-insiders-linux.mjs", import.meta.url);

test("packages the verified official archive and generates Linux integration files", () => {
  const directory = mkdtempSync(join(tmpdir(), "vscode-insiders-package-test-"));
  const source = join(directory, "source");
  const app = join(source, "VSCode-linux-x64");
  const archive = join(directory, "source.tar.gz");
  const output = join(directory, "package.tar.gz");

  try {
    mkdirSync(join(app, "bin"), { recursive: true });
    mkdirSync(join(app, "resources/app/resources/linux"), { recursive: true });
    writeFileSync(join(app, "bin/code-insiders"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(app, "bin/code-tunnel-insiders"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(app, "code-insiders"), "#!/bin/sh\nexit 0\n");
    writeFileSync(
      join(app, "resources/app/package.json"),
      JSON.stringify({ desktopName: "code-insiders.desktop", version: "1.140.0-insider" }),
    );
    writeFileSync(join(app, "resources/app/resources/linux/code.png"), "icon");
    execFileSync("tar", ["-czf", archive, "-C", source, "VSCode-linux-x64"]);
    const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");

    const result = spawnSync(
      process.execPath,
      [script.pathname, "--source-archive", archive, "--source-sha256", sha256, "--output", output],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const entries = execFileSync("tar", ["-tzf", output], { encoding: "utf8" });
    assert.match(entries, /usr\/share\/code-insiders\/bin\/code-insiders/);
    assert.match(entries, /usr\/share\/applications\/code-insiders\.desktop/);
    assert.match(entries, /usr\/share\/applications\/code-insiders-url-handler\.desktop/);
    assert.match(entries, /usr\/share\/mime\/packages\/code-insiders-workspace\.xml/);
    assert.match(entries, /usr\/share\/pixmaps\/vscode-insiders\.png/);

    const desktop = execFileSync("tar", ["-xOzf", output, "./usr/share/applications/code-insiders.desktop"], {
      encoding: "utf8",
    });
    assert.match(desktop, /^Exec=\/usr\/share\/code-insiders\/code-insiders %F$/m);
    assert.match(desktop, /application\/x-code-insiders-workspace;/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an archive that does not match Microsoft's published checksum", () => {
  const directory = mkdtempSync(join(tmpdir(), "vscode-insiders-checksum-test-"));
  const source = join(directory, "source");
  const app = join(source, "VSCode-linux-x64");
  const archive = join(directory, "source.tar.gz");
  const output = join(directory, "package.tar.gz");

  try {
    mkdirSync(join(app, "bin"), { recursive: true });
    writeFileSync(join(app, "bin/code-insiders"), "binary");
    execFileSync("tar", ["-czf", archive, "-C", source, "VSCode-linux-x64"]);

    const result = spawnSync(
      process.execPath,
      [script.pathname, "--source-archive", archive, "--source-sha256", "0".repeat(64), "--output", output],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Microsoft archive SHA256 mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
