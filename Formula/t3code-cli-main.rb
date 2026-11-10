class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-main.20261110061418.934c7f8d8e7a/t3code-cli-main-main.20261110061418.934c7f8d8e7a.tar.gz"
  version "main.20261110061418.934c7f8d8e7a"
  sha256 "fc7fc80aaf50fcd9314738a30dc78441b9011e7a060bc08e9ff15ffa73495a4e"
  license "MIT"
  version_scheme 1

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux
  depends_on "node@24"

  def install
    libexec.install Dir["*"]

    (bin/"t3").write <<~SH
      #!/bin/bash
      # Runtime opt-out: build environment variables do not persist into installed apps.
      export T3CODE_TELEMETRY_ENABLED=false
      entry="#{libexec}/dist/bin.mjs"
      if [ ! -f "$entry" ]; then
        entry="#{libexec}/dist/index.mjs"
      fi
      exec "#{formula_opt_bin("node@24")}/node" "$entry" "$@"
    SH
  end

  service do
    run [opt_bin/"t3", "serve"]
    keep_alive true
    working_dir Dir.home
    environment_variables(
      T3CODE_HOME:              "#{Dir.home}/.t3",
      T3CODE_TELEMETRY_ENABLED: "false",
      PATH:                     [
        "#{HOMEBREW_PREFIX}/bin",
        "#{HOMEBREW_PREFIX}/sbin",
        "#{Dir.home}/.local/bin",
        "#{Dir.home}/bin",
        "#{Dir.home}/.cargo/bin",
        "#{Dir.home}/.deno/bin",
        "#{Dir.home}/.bun/bin",
        "#{Dir.home}/go/bin",
        "#{Dir.home}/.opencode/bin",
        "#{Dir.home}/.local/share/mise/shims",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(":"),
    )
    log_path var/"log/t3code-cli-main.log"
    error_log_path var/"log/t3code-cli-main.log"
  end

  test do
    (testpath/"telemetry-check.cjs").write <<~JS
      if (process.env.T3CODE_TELEMETRY_ENABLED !== "false") {
        throw new Error("T3 Homebrew launcher did not disable telemetry");
      }
    JS
    with_env("T3CODE_TELEMETRY_ENABLED" => "true", "NODE_OPTIONS" => "--require=#{testpath}/telemetry-check.cjs") do
      output = shell_output("#{bin}/t3 --help")
      assert_match "USAGE", output
    end
  end
end
