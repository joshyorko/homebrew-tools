cask "rcc" do
  version "18.19.10"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "6065ee45bedbf129e172ef0ac5eae92951db127f73e0602f8fe66e35fe1ae32a"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.10/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "2bcf41106dd927ea9969569f470acc3bbba81df8709db8e16db63e399a968a67"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.10/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "6fcbaca47eabd90855a3a7ea733dc30df60f6f5067f99b77d87949035072921c"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/rcc-18.19.10/rcc-linux64"
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
