cask "rcc" do
  version "18.17.6"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "7a42c84a0650621739b1c9c8b4b065a2845d9c72e6d443c41737e7aefb45e423"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.6/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "a7c2f31ef24fea31125444ca36eeb0ca60d794725bbcc340fb90edefbf38ee71"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.6/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "18480cd62f4a8e947e18f93277afcc2f1ee23e020be51c1d0b61397256a78912"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.6/rcc-linux64"
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
