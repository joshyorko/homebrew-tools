cask "rcc" do
  version "18.18.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "e03d656e7a7fb800f5432ba7f955f6bf8e1ac4150b719b189893eee8c00340bd"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.18.0/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "56928b5f8e90c0b4440f5e7af48ed5f403b7d7f4c2419f3fd8db534d2496c6f3"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.18.0/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "dc414e9bb11cb338060ce17d6ee70ab63f42f0838ac683f04831c4bf685ed350"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.18.0/rcc-linux64"
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
