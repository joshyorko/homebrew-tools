class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-2026.03.23.754cded24abe/t3code-cli-main-2026.03.23.754cded24abe.tar.gz"
  version "2026.03.23.754cded24abe"
  sha256 "3719f7301827d15e153bf26544f6b5d809eccdc3301e89dcc32303bab3c86690"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on "node@24"
  depends_on :linux

  def install
    libexec.install Dir["*"]

    (bin/"t3").write <<~SH
      #!/bin/bash
      exec "#{Formula["node@24"].opt_bin}/node" "#{libexec}/dist/index.mjs" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/t3 --help")
    assert_match "USAGE", output
  end
end
