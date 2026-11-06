class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.11"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.11/review-x86_64.tar.gz"
      sha256 "4674b7f6af619d751356197037fc9a76086cf6be063d97b23a334625068aff01"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.11/review-aarch64.tar.gz"
      sha256 "004b4dadcba48c360e4bc47b8ec0fc71b40838fcd51714cfe637d3bf11f7a302"
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
