class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.7"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.7/review-x86_64.tar.gz"
      sha256 "01c9ad0cef73c4835cc9f5a8b30a1cb6b10afc37f9dfa7664c52ab719ef2c98f"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.7/review-aarch64.tar.gz"
      sha256 "e9293529dca8c633e6f88651c4d8daef29e8a5010e567980b88db8f6b59197fc"
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
