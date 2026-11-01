class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.9"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.9/review-x86_64.tar.gz"
      sha256 "860edfc098c262e86898a44cf9cbc88621422902743426d9c7dccd0c871ab823"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.9/review-aarch64.tar.gz"
      sha256 "a8c0aa3032892fe119582aa634dac4b6db783fa088e4219615541801d9df26c5"
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
