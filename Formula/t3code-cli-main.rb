class T3codeCliMain < Formula
  desc "T3 Code CLI built from pingdotgg/t3code main"
  homepage "https://github.com/pingdotgg/t3code"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3code-cli-main-main.20261028124103.6bc87b94e15c/t3code-cli-main-main.20261028124103.6bc87b94e15c.tar.gz"
  version "main.20261028124103.6bc87b94e15c"
  sha256 "639efc1ed4d6cb0d3db0becd9bd394f8a60039875b65e5751978c0160c018754"
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
