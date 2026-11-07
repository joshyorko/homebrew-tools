class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-main.20261107063824.257e4073c1c5/t3code-cli-main-main.20261107063824.257e4073c1c5.tar.gz"
  version "main.20261107063824.257e4073c1c5"
  sha256 "20dcc61eea00422fc678bfae107104f55447620b456bdc4b05a8aefc510ce293"
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
      exec "#{Formula["node@24"].opt_bin}/node" "$entry" "$@"
    SH
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
