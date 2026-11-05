cask "rcc" do
  version "18.19.8"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "bf11dcee5a1e009a3f5b456bc8a24eb8f3f5d064eb7962c5e90956f13d4dfcba"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.8/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "275435acd28e43dbd5f6268d109ac1cd5b2ed1fab76d4a1504b423b590ac94d1"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.8/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "ea8dc96e66d7a81536b03a344b4eaf44bbd94122585954e70290bd466f5de4b6"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.8/rcc-linux64"
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
