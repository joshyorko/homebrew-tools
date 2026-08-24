cask "rcc" do
  version "18.19.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "1481c1237ac9b1b7a24e4afebb13f2c13f95f4c85c9fe431bc1e25e5a39effd4"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.0/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "45201e4bbdb891248cea8ed0ded3d23ceb5118e151cbe2098f6da51082fc383a"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.0/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "88b0b834981599c8eddb108ef98a44dd213e819b2f339986cd5f81b5b8732774"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.0/rcc-linux64"
    binary "rcc-linux64", target: "rcc"
  end

  name "RCC"
  desc "RCC - Repeatable Contained Code automation runtime"
  homepage "https://github.com/joshyorko/rcc"

  caveats <<~EOS
    If 'rcc' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.
  EOS
end
