class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-smoke.f6978db60553/t3code-cli-main-smoke.f6978db60553.tar.gz"
  version "smoke.f6978db60553"
  sha256 "f0eb15691c6da074fa0c36c3a29f7b75f02da6fd5648c79a97e71c896dfe18b1"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux
  depends_on "node@24"

  def install
    libexec.install Dir["*"]

    (bin/"t3").write <<~SH
      #!/bin/bash
      entry="#{libexec}/dist/bin.mjs"
      if [ ! -f "$entry" ]; then
        entry="#{libexec}/dist/index.mjs"
      fi
      exec "#{Formula["node@24"].opt_bin}/node" "$entry" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/t3 --help")
    assert_match "USAGE", output
  end
end
