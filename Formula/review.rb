class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.12"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.12/review-x86_64.tar.gz"
      sha256 "5a01039990926dee06de047a9391c4bc140ee29b82499fc7943929e97a48de6e"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.12/review-aarch64.tar.gz"
      sha256 "b365a2fd8a5fad27df791b9dee012110689bed2d43417455f7cc5d337fb650a6"
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
