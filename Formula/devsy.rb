class Devsy < Formula
  desc "Development environment platform for containers and Kubernetes"
  homepage "https://devsy.sh/"
  version "1.23.0"
  license "MPL-2.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.23.0/devsy-linux-amd64"
      sha256 "bf6e00b498a09ed614670ce24bd7cf46830b31218e773961f6c267c1a25b8186"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.23.0/devsy-linux-arm64"
      sha256 "4418123145970d9ec9034c7d966a9b27571e47820c59886e31965911aa7518d7"
    end
  end

  def install
    binary = Dir["devsy-linux-*"].first
    raise "Devsy release binary was not downloaded" unless binary

    chmod 0755, binary
    bin.install binary => "devsy"
  end

  test do
    ENV["DEVSY_HOME"] = testpath.to_s
    assert_equal "v#{version}\n", shell_output("#{bin}/devsy --version")
  end
end
