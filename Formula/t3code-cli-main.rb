class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-2026.03.17.1310045629f6/t3code-cli-main-2026.03.17.1310045629f6.tar.gz"
  version "2026.03.17.1310045629f6"
  sha256 "5548a7e3b7fa44f353c5492e5c6bf52515762caa65b9a34d56ba04ef25d4d227"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on "node"
  depends_on :linux

  def install
    ENV["npm_config_cache"] = buildpath/"npm_cache"
    ENV["npm_config_update_notifier"] = "false"
    ENV["npm_config_fund"] = "false"
    ENV["npm_config_audit"] = "false"

    libexec.install Dir["*"]

    cd libexec do
      system Formula["node"].opt_bin/"npm", "ci", "--omit=dev"
    end

    (bin/"t3").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/index.mjs" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/t3 --help")
    assert_match "Usage", output
  end
end
