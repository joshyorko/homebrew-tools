class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-main.20261101005429.8b74a69019e3/t3code-cli-main-main.20261101005429.8b74a69019e3.tar.gz"
  version "main.20261101005429.8b74a69019e3"
  sha256 "2877a464024af01222615b9982e1a80d1ce47e0f65239b6425c095ef8aa6ee7c"
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
