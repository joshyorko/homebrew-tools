cask "rcc" do
  version "18.19.9"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "00aa9ceb432ef9f144117a7887ad2fcf9c392926212ba316aef4cd724c3a9df0"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.9/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "6bd3859b08e25b80eac28e6dd983dca1443a3225966be4172af85a465f6b7f21"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.9/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "e1b20ca222708981e2e18b81ae6ca1e9d9c17abc2b837779c5fc0d6bd53798b8"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.9/rcc-linux64"
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
