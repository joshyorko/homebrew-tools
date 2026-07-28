class Devsy < Formula
  desc "Development environment platform for containers and Kubernetes"
  homepage "https://devsy.sh/"
  version "1.11.0"
  license "MPL-2.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.11.0/devsy-linux-amd64"
      sha256 "c800da1c895e57990cbcc9dc411da779640fbefc986a592ab14db80589dad215"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.11.0/devsy-linux-arm64"
      sha256 "94ad4f562e3210dc823e2fc3ad4250f62e25218d7edcb95b40d04a3fcab1be0c"
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
