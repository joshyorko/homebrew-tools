class HeadroomSelfHosted < Formula
  desc "Self-hosted Headroom CLI and proxy from the pinned self-hosted source"
  homepage "https://github.com/joshyorko/headroom"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/headroom-self-hosted-selfhosted.5cd61fe769d6/headroom-self-hosted-selfhosted.5cd61fe769d6.tar.gz"
  version "selfhosted.5cd61fe769d6"
  sha256 "585201ec9b28c4f01b3c4e0c111fe27bf8c6a12936076843373b9fa7e634d417"
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
