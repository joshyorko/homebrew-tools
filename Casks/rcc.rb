cask "rcc" do
  version "18.17.7"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "54ca217a44c6cea9ab2eb85902dc1871257f47ca39418b064d852f990f80bccd"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.7/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "20103ef2fd902daa0ed28602297450b4b88a772baa11f714988fcb49ba27baf6"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.7/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "b49c5bdf98f55694ca366d715a260a0c54943b835a6dd8571fdf5c3260df17cf"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.17.7/rcc-linux64"
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
