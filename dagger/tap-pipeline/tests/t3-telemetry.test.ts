import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

// Execute the actual shipped launcher bodies, substituting only Homebrew paths.
// A probe replaces the application: this proves exec-time inheritance, not network silence.
for (const desktop of [false, true]) {
  for (const inherited of [undefined, "true", "false"]) {
    test(`${desktop ? "desktop" : "CLI"} launcher opts out with inherited ${inherited}`, () => {
      const root = mkdtempSync(join(tmpdir(), "t3-telemetry-"))
      try {
        const source = readFileSync(new URL(desktop
          ? "../../../Casks/t3-code-linux.rb"
          : "../../../Formula/t3code-cli-main.rb", import.meta.url), "utf8")
        const body = source.match(/(?:\(bin\/"t3"\)\.write <<~SH|write_file "t3-code-linux-wrapper", <<~'SH')\n([\s\S]*?)\n    SH/)?.[1]
        assert.ok(body, "launcher heredoc must exist")
        mkdirSync(join(root, "dist"))
        mkdirSync(join(root, "squashfs-root"))
        writeFileSync(join(root, "dist/bin.mjs"), "")
        const probe = join(root, desktop ? "squashfs-root/AppRun" : "node")
        writeFileSync(probe, '#!/bin/bash\nprintf "%s\\n" "$T3CODE_TELEMETRY_ENABLED" "$@"\n', { mode: 0o755 })
        const launcher = body.replace(/^      /gm, "")
          .replaceAll('#{Formula["node@24"].opt_bin}', root)
          .replaceAll("#{libexec}", root)
          .replaceAll("{{staged_path}}", root)
          .replaceAll("{{HOMEBREW_PREFIX}}", root)
        const env = { ...process.env, HOME: root }
        delete env.T3CODE_TELEMETRY_ENABLED
        if (inherited !== undefined) env.T3CODE_TELEMETRY_ENABLED = inherited
        const output = execFileSync("bash", ["-c", launcher, "launcher", "argument with spaces"], { env, encoding: "utf8" })
        assert.deepEqual(output.trim().split("\n"), ["false", desktop ? "--no-sandbox" : join(root, "dist/bin.mjs"), "argument with spaces"])
        if (desktop) assert.match(source, /Exec=\{\{HOMEBREW_PREFIX\}\}\/bin\/t3-code-linux %U/)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
}
