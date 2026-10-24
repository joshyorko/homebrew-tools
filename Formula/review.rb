class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.0"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.0/review-x86_64.tar.gz"
      sha256 "8e8f7db6e7efb36338d8a1e2b14035ccbf2ca027f56c19341db95f896c336b2d"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.0/review-aarch64.tar.gz"
      sha256 "83f3b6532c0b4865ebfb70bb89286b5d704a3df192270e19502dbc6bd0716418"
    end
  end

  depends_on :linux
  depends_on "apptainer"
  depends_on "squashfuse"
  depends_on "gh"

  def install
    bin.install "review"
    libexec.install "launcher", "build.json", "build.txt", "LICENSE", "NOTICE"
  end

  test do
    assert_match "Usage", shell_output("#{bin}/review --help")
    assert_path_exists libexec/"launcher/review.sif"
    assert_path_exists libexec/"build.json"
  end
end
