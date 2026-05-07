class FizzySymphony < Formula
  desc "Fizzy-backed Symphony daemon built from joshyorko/fizzy-symphony main"
  homepage "https://github.com/joshyorko/fizzy-symphony"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-symphony-main.20260507162622.7b5c054d3e3d/fizzy-symphony-main.20260507162622.7b5c054d3e3d.tar.gz"
  version "main.20260507162622.7b5c054d3e3d"
  sha256 "04efaa851821e5cb763fd75a63cfd456522d66d4994324683a573cdfcc7f43db"
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
