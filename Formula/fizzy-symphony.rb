class FizzySymphony < Formula
  desc "Fizzy-backed Symphony daemon built from joshyorko/fizzy-symphony main"
  homepage "https://github.com/joshyorko/fizzy-symphony"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-symphony-main.20260806140822.8d330a94eebe/fizzy-symphony-main.20260806140822.8d330a94eebe.tar.gz"
  version "main.20260806140822.8d330a94eebe"
  sha256 "3425f6efe3fdde80840c5a211b1e43465f5317e274bec81349aad221f8e1ac5d"
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
