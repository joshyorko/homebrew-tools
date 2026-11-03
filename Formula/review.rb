class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.10"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.10/review-x86_64.tar.gz"
      sha256 "68ac5a872bb96b09d73c416708fd71d3fb7689f89dc7f30772c05b05363cf52d"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.10/review-aarch64.tar.gz"
      sha256 "9202086755fbb1d0d0a34642d6a351fe763cadcfe4c42ffa06602344df7716a6"
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
