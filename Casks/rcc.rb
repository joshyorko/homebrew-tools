cask "rcc" do
  version "18.17.0"

  on_macos do
    on_arm do
      sha256 "31954b6db5740cd9e9e7cbc8e746c6a9b0abdc0c4479670e24c39ec622e74420"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "37da8d2511e235b7bc47395faac382d2e6d83fea971263cc13acc1b01c57be4e"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "e54ba2314e09f7d87af2253d87c64cbfc1d55108d95989d3660888c4e5f4036c"
    url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-linux64"
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
