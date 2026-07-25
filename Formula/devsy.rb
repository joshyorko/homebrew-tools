class Devsy < Formula
  desc "Development environment platform for containers and Kubernetes"
  homepage "https://devsy.sh/"
  version "1.7.0"
  license "MPL-2.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.7.0/devsy-linux-amd64"
      sha256 "25c39fe127fdfb969769780d1adce5c8a34f9152a38882fe906f109f851c5297"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-1.7.0/devsy-linux-arm64"
      sha256 "89a1ee994df5697146b61d88876c64a71cc15c584925ffbebe6b65fa5c61d98a"
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
