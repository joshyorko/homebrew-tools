class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-2026.03.30.6f517257325f/t3code-cli-main-2026.03.30.6f517257325f.tar.gz"
  version "2026.03.30.6f517257325f"
  sha256 "34247e0999f1c4d02e687e10a7519e27cd4c97e2d746b33ed107bd651d08aaca"
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
