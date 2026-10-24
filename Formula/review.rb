class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.2"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.2/review-x86_64.tar.gz"
      sha256 "ee889c226daf9364cb7915e9ba6d3bad0fe759607f934c909d5bc24ba96a25cc"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.2/review-aarch64.tar.gz"
      sha256 "b19b75d5528cca6a1b3fc6ffcc9880a5938d7e02aa37e3f8306af4f0a10d84f7"
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
