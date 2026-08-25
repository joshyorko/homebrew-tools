cask "rcc" do
  version "18.19.2"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "3e3fb064fced1ce6abafda1d6c9ba54fdadfd86b762c0cd593e5f60b553f767f"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.2/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "8648f47c1663919695a6bce0b6346cd0a383058b2bc21655d5b3214f7c481a53"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.2/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "3a90a331325feb5b75b3ebc7492303a964438ce017347f451aeee3ed7d578b3d"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.2/rcc-linux64"
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
