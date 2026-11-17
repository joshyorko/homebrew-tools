class T3codeCliMain < Formula
  desc "T3 Code CLI built from an upstream nightly with Homebrew patches"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-0.1.11-nightly.20261117.4814.homebrew.1.77aaabb06161/t3code-cli-main-0.1.11-nightly.20261117.4814.homebrew.1.77aaabb06161.tar.gz"
  version "0.1.11-nightly.20261117.4814.homebrew.1.77aaabb06161"
  sha256 "ce371b08f68d0c0caa7cb834fdd1724a66ce486dac78c5e9046e8f6931780911"
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
