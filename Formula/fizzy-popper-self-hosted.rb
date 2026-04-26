class FizzyPopperSelfHosted < Formula
  desc "Fizzy Popper built from joshyorko/fizzy-popper self-hosted branch."
  homepage "https://github.com/joshyorko/fizzy-popper/tree/self-hosted"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/fizzy-popper-self-hosted-selfhosted.a55b9fe2f9e7/fizzy-popper-self-hosted-selfhosted.a55b9fe2f9e7.tar.gz"
  version "selfhosted.a55b9fe2f9e7"
  sha256 "93e1d939effef5e569d67e80b53c869f6a482ace9716642cef198d4666fde3b7"
  license "MIT"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux
  depends_on "node@24"

  conflicts_with "fizzy-popper", because: "both install a fizzy-popper executable"

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

      The unique formula name keeps it separate from any future upstream fizzy-popper
      package, but the installed executable stays `fizzy-popper`.
    EOS
  end

  test do
    output = shell_output("#{bin}/fizzy-popper --version")
    assert_match version.to_s, output
  end
end
