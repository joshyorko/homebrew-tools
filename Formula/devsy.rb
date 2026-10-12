class Devsy < Formula
  desc "Development environment platform for containers and Kubernetes"
  homepage "https://devsy.sh/"
  version "1.23.2"
  license "MPL-2.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.23.2/devsy-linux-amd64"
      sha256 "0e9e703662575faa796c933e108bbaa9bcfbcf95046825da9c8eb3cf452e8891"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.23.2/devsy-linux-arm64"
      sha256 "872cd988be2f5c37dc92da684c92fb6e9dd56153963366c1bdb143b78f816ae2"
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
