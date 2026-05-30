cask "rcc" do
  version "18.17.5"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "17528c263aa73962ce7eb5c3ac1b32de13d7214783c9d3f80f6db69d13acad63"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.5/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "ad2131ba3d37b3edf54bef4433eb66c083c942845ea22db9180155d63e0a6aff"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.5/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "385411ca4439938fdbdf70c3a999bb6a3659b075a406bcb7b09f3e4083459a8f"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.5/rcc-linux64"
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
