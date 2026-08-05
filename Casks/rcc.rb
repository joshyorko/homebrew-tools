cask "rcc" do
  version "18.18.1"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "57d2fe4fb0dc54f2bd09ed0d1c3f3ace28d85a1370dc1984d2d6a8190024798d"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.18.1/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "1b13fdc14abe08613e236492865d48fc9d4dbc318d9b309113410d0556442c44"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.18.1/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "ab6e25fe616878d79ed2d92ee9c5073d360d8cde637dcf02f2c9bb4b4ef0bfcf"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.18.1/rcc-linux64"
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
