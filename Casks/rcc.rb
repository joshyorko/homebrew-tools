cask "rcc" do
  version "18.19.11"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "23c665387951289b16a3d9be3103498598dce94d55327e103758df944ca067e7"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.11/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "b3fe1fe2972136cfa58261f49cc4f5e9f12bed5041d49b2035561366b3d5ef6c"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.11/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "4d68609044d3a39a1728d571d54c77a6174215adb40eb9acd69ce5ad34a6db1f"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.11/rcc-linux64"
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
