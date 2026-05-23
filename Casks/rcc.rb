cask "rcc" do
  version "18.17.4"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "01a9eec45b1102fd7efcf4e32ed9ab7bf2fd9f8d8e4e6881d889207670066729"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.4/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "b98153ccff4325994ccfd651b47d06711fff526de4aa5822f2e744e959246a23"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.4/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "bf74746f248f4e2f3d7924c8ff555d1148478561a3a265730cb10d03dab0470b"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.4/rcc-linux64"
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
