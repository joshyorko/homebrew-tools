class Review < Formula
  desc "Review GitHub repositories with OMP in an isolated appliance"
  homepage "https://github.com/joshyorko/review"
  version "0.1.5"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/review/releases/download/v0.1.5/review-x86_64.tar.gz"
      sha256 "6a2f8baa342aea1e2e47a486d262cc091aad7da1df5c036611fb0ef1a7256759"
    end
    on_arm do
      url "https://github.com/joshyorko/review/releases/download/v0.1.5/review-aarch64.tar.gz"
      sha256 "adab021f0fc4dcb7e453f3bd45c13215c98a131b746827fb55c27a3cd32232cb"
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
