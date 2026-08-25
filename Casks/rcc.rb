cask "rcc" do
  version "18.19.1"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "e7b9916dd8cce7a40d3e2771ae599e7adb6d030d34abea2ba953ca4e77e92859"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.1/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "607d2af5897490a3634a0cff622843770a907bdb2780f3b8fa3beba38a628929"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.1/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "c9dff2059b0a7b7a970ee9bd725752e7f6a46718e799bea45ed2263ab9cb5c5b"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.1/rcc-linux64"
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
