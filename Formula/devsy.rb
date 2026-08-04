class Devsy < Formula
  desc "Development environment platform for containers and Kubernetes"
  homepage "https://devsy.sh/"
  version "1.14.0"
  license "MPL-2.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.14.0/devsy-linux-amd64"
      sha256 "e24178c17ebbf663f37e548eb63417c5ba86b6c72afba5e9b3790049bce2d055"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.14.0/devsy-linux-arm64"
      sha256 "9e7566ce61deb831152714bd9722dd03671143f54d65f5b2e7b10db44b6c29f0"
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
