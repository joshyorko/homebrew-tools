class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.8"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.8/review-x86_64.tar.gz"
      sha256 "9737d6b7871466be35d144584ba3e9e3ed89409e4a27668781ba10666bddbf9b"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.8/review-aarch64.tar.gz"
      sha256 "371711d2eeea06c1d5375827a9a1aea98ba19ae87103e9951482d3ff5eb7ab44"
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
