cask "rcc" do
  version "18.13.0"
  sha256 "11f7f4ed82552971ad0e25772385d659e618fecedfdcd6a8a22b9e78f24bbb8c"

  url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-linux64"
  name "RCC"
  desc "RCC - Repeatable Contained Code automation runtime"
  homepage "https://github.com/joshyorko/rcc"

  binary "rcc-linux64", target: "rcc"

  caveats <<~EOS
    If 'rcc' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.
  EOS
end
