class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.3"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.3/review-x86_64.tar.gz"
      sha256 "bc03d8b81f92482931d4e2f4a89c1a347238c7ad581cd18614c34d09aa4c85e7"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.3/review-aarch64.tar.gz"
      sha256 "d3ab7b3d486af98040949e236e582c2587b9c2a7674a65e56ee138c2dac246b1"
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
