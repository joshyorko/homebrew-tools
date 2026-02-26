cask "rcc" do
  version "18.17.3"

  on_macos do
    on_arm do
      sha256 "4b426fb7a3754b500488b772a47a14fdc6325da455a8067c039353faedd7a368"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "e748ced4b0e2511bc711325a784f5f31e5d7591bb58f8e73578071fdc8bff414"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "b1244cd6f8c9415e5f24f98f972620475bdced1c24590b3e823ade8e04acb62e"
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
