cask "rcc" do
  version "18.19.5"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "867cc6b19c36eae76f01d7004c0a0e322863583af867f6f8201c263eb0febabb"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.5/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "34887e542f9db963987d260eff1f6767268b6c7f96a8282221485e60cbb440c5"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.5/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "1a617ad7c736fa67c605e20e5ebe3c7d54b02cd548f733e05c809cf49a48db1e"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.5/rcc-linux64"
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
