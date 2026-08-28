cask "rcc" do
  version "18.19.3"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "778402ccdb7c10e10fbdad7baa7c27b44563c1a90a9527e096101a21178e0266"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.3/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "e5be77c162946b022f3f244e3506ce353e7016b9b23f1e798c673616c2e99efe"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.3/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "7e588c01751ca2ae15ba13ef67f2f4b7567697a5a8389737059a73936f509428"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.3/rcc-linux64"
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
