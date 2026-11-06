class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-main.20261106005018.d929e726f223/t3code-cli-main-main.20261106005018.d929e726f223.tar.gz"
  version "main.20261106005018.d929e726f223"
  sha256 "bdd414ea4db050bd00fe16407d4605f15710f8a992316336c5e153d7051008ed"
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
