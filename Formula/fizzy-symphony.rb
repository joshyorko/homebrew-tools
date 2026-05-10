class FizzySymphony < Formula
  desc "Fizzy-backed Symphony daemon built from joshyorko/fizzy-symphony main"
  homepage "https://github.com/joshyorko/fizzy-symphony"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-symphony-main.20260510160750.82e174215303/fizzy-symphony-main.20260510160750.82e174215303.tar.gz"
  version "main.20260510160750.82e174215303"
  sha256 "a0397b97813a619faa7d3ed5eb82793770429b732b5cca1b05483ac22f413e90"
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
    output = shell_output("#{bin}/fizzy-symphony --help")
    assert_match "fizzy-symphony start", output

    config = testpath/"config.yml"
    output = shell_output("#{bin}/fizzy-symphony setup --template-only --config #{config}")
    assert_match "wrote annotated config", output
    assert_path_exists config
    assert_match "fizzy-symphony config", config.read
  end
end
