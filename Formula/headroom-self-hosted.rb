class HeadroomSelfHosted < Formula
  desc "Self-hosted Headroom CLI and proxy from the pinned self-hosted source"
  homepage "https://github.com/joshyorko/headroom"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/headroom-self-hosted-selfhosted.cb528b994695/headroom-self-hosted-selfhosted.cb528b994695.tar.gz"
  version "selfhosted.cb528b994695"
  sha256 "ef36e03475b07cd52f51e3f41fee4c6bf88695ad3464fce347d3458ffde20e18"
  license "Apache-2.0"

  livecheck do
    skip "Built from an exact self-hosted source commit by the tap release pipeline."
  end

  depends_on :linux
  depends_on "python@3.13"

  def install
    libexec.install Dir["*"]
    python = Formula["python@3.13"].opt_bin/"python3.13"
    system python, "-m", "venv", libexec/"venv"
    system libexec/"venv/bin/pip", "install", "--no-index", "--find-links=#{libexec}/wheelhouse", "headroom-ai[proxy]"

    (bin/"headroom").write <<~SH
      #!/bin/bash
      exec "#{libexec}/venv/bin/headroom" "$@"
    SH
  end

  test do
    assert_match "Usage", shell_output("#{bin}/headroom --help")
    assert_match "proxy", shell_output("#{bin}/headroom proxy --help")
  end
end
