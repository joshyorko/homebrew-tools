class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.1"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.1/review-x86_64.tar.gz"
      sha256 "5a644c8899dbe02fc71174d8550dafec5ea964cd14b549585b2feae1151eeeac"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.1/review-aarch64.tar.gz"
      sha256 "c5ff31988502bdb66f5344e39f682c823527b545a73502dcb76cf02e55812325"
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
