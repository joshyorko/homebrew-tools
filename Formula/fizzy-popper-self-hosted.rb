class FizzyPopperSelfHosted < Formula
  desc "Fizzy Popper snapshot from joshyorko/fizzy-popper self-hosted branch"
  homepage "https://github.com/joshyorko/fizzy-popper/tree/self-hosted"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-popper-self-hosted-selfhosted.20260427234405.ae20f72969e8/fizzy-popper-self-hosted-selfhosted.20260427234405.ae20f72969e8.tar.gz"
  version "selfhosted.20260427234405.ae20f72969e8"
  version_scheme 1
  sha256 "874fa01f56f131a3e05567533178fc2c7aafb333ed61766306f4e86e57f4dd93"
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
