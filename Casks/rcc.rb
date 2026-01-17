cask "rcc" do
  version "18.16.0"

  on_arm do
    sha256 "02fdc2c59510bce8fcf2bf0dc40d7b71f7f343e3d982247af9a21e63b6aad543"
    url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macosarm64"
    binary "rcc-macosarm64", target: "rcc"
  end

  on_intel do
    sha256 "242ec7ef6ac7c7c2d0f2fbb2cce44e67580d4db47edb1f75954129b38aa046bb"
    url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macos64"
    binary "rcc-macos64", target: "rcc"
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
