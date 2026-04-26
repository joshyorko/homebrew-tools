class FizzyPopperSelfHosted < Formula
  desc "Fizzy Popper snapshot from joshyorko/fizzy-popper self-hosted branch"
  homepage "https://github.com/joshyorko/fizzy-popper/tree/self-hosted"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-popper-self-hosted-selfhosted.d08b71dff98d/fizzy-popper-self-hosted-selfhosted.d08b71dff98d.tar.gz"
  version "selfhosted.d08b71dff98d"
  version_scheme 1
  sha256 "8d9ba611b7d5eba1c6ee22804e0d2a58387464e8f2d200a72be6891ab2b7cfc0"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux
  depends_on "node@24"

  def install
    libexec.install Dir["*"]

    (bin/"fizzy-popper").write <<~SH
      #!/bin/bash
      exec "#{Formula["node@24"].opt_bin}/node" "#{libexec}/dist/cli.js" "$@"
    SH
  end

  def caveats
    <<~EOS
      This formula tracks Josh Yorko's self-hosted fork branch:
        https://github.com/joshyorko/fizzy-popper/tree/self-hosted

      The tap release version identifies the source commit snapshot. The Node package
      inside the artifact currently keeps fizzy-popper's own package version.

      The unique formula name keeps it separate from any future upstream package,
      but the installed executable stays `fizzy-popper`.
    EOS
  end

  test do
    output = shell_output("#{bin}/fizzy-popper --help")
    assert_match "Watch boards and dispatch agents", output
  end
end
