class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.4"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.4/review-x86_64.tar.gz"
      sha256 "3a0f6cd98212034e1a054380479a28176bc72afeef6d1bc36424f469d93183bf"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.4/review-aarch64.tar.gz"
      sha256 "be12fb736a3e34003b1ba23030b7d901ab240911c4bfaef3055b42f05e75f8d4"
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
