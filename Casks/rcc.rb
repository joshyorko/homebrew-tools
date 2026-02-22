cask "rcc" do
  version "18.17.2"

  on_macos do
    on_arm do
      sha256 "57a2ef3cdf969706104ac0d2409ebef0202cb7e1e1ee09ad0a8272c3fba6e493"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "86cda8bfe680d4e353bb662000348a77b1de7f9362347d0cd73ed36de483a525"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "843ab19cca36f5b34dd03cb9640a1cc683a654cf00783923ab67e024c955470a"
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
