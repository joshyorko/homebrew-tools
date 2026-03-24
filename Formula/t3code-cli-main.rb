class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-2026.03.24.529315b4c8ec/t3code-cli-main-2026.03.24.529315b4c8ec.tar.gz"
  version "2026.03.24.529315b4c8ec"
  sha256 "0004856d189a8bd2d3d9eefcbd3d7753c8b1db246d827812fc22071955cde087"
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
