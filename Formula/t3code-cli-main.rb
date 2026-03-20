class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-2026.03.20.8f11ea44a75b/t3code-cli-main-2026.03.20.8f11ea44a75b.tar.gz"
  version "2026.03.20.8f11ea44a75b"
  sha256 "d2d348d041e9834c8e33d189a3546da67ce4d3af095cfbb792426c462c9312b7"
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
