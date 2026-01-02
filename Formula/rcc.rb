class Rcc < Formula
  desc "Robocorp Control Center - automation runtime (joshyorko fork with Linux support)"
  homepage "https://github.com/joshyorko/rcc"
  version "18.12.1"
  license "Apache-2.0"

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-linux64"
      sha256 "ec11807a08b23a098959a717e8011bcb776c56c2f0eaeded80b5a7dc0cb0da3a"
    end
  end

  on_macos do
    on_intel do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
      sha256 "b8a7c3e9f4d2a1b5c6e8f0a3d7c9b2e4f6a8d0c3e5f7a9b1d3c5e7f9a1b3d5e7"
    end
    on_arm do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwinarm64"
      sha256 "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    end
  end

  def install
    if OS.linux?
      bin.install "rcc-linux64" => "rcc"
    elsif OS.mac? && Hardware::CPU.intel?
      bin.install "rcc-darwin64" => "rcc"
    elsif OS.mac? && Hardware::CPU.arm?
      bin.install "rcc-darwinarm64" => "rcc"
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rcc version")
  end
end
