cask "rcc" do
  version "18.19.12"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "9ebad0eb4ea52069ba28dfad341c5741de3f7e4fa4e45b4a19432f65c27b622c"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.12/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "db7390a1a7c6be543bd6079c83a6d1b193c93038dce3e2e500713f9bd0f32197"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.12/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "0a13e78201a71c1bbc19a2ee8ccc86dd60a67ec4ffa8cd3a9a8f254d148849ee"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.12/rcc-linux64"
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
