class FizzySymphony < Formula
  desc "Fizzy-backed Symphony daemon built from joshyorko/fizzy-symphony main"
  homepage "https://github.com/joshyorko/fizzy-symphony"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-symphony-main.20260506093204.bcf106b0c2da/fizzy-symphony-main.20260506093204.bcf106b0c2da.tar.gz"
  version "main.20260506093204.bcf106b0c2da"
  sha256 "a24af34d4d3d5999f26fb538506315f1cb86e58762c068da1c6fecdfc25c1473"
  license :cannot_represent

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux
  depends_on "node"

  def install
    libexec.install Dir["*"]

    (bin/"fizzy-symphony").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/fizzy-symphony.js" "$@"
    SH
  end

  def caveats
    <<~EOS
      This formula tracks joshyorko/fizzy-symphony main snapshots.

      The tap release version identifies the source commit snapshot. The Node package
      inside the artifact currently keeps fizzy-symphony's own package version.
    EOS
  end

  test do
    output = shell_output("#{bin}/fizzy-symphony")
    assert_match "fizzy-symphony start", output
  end
end
