cask "rcc" do
  version "18.19.7"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "324e2ead0e96754eaf0dc2e22bb41928ad2bec90c7e1e7ad069038a100bca595"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.7/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "092c8efb615e5d948d16a7330be76c99583c42df2c8a541a6f31f3aaeaeb1a89"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.7/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.7/rcc-linux64"
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
