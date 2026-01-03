cask "rcc" do
  version "18.13.0"

  on_intel do
    if OS.linux?
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-linux64"
      sha256 "11f7f4ed82552971ad0e25772385d659e618fecedfdcd6a8a22b9e78f24bbb8c"
    else
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
      sha256 "c150acf979d2e8d7dfe52c905fa09ad8dc394eca5fb75363333548792d041f77"
    end
  end

  on_arm do
    # Note: No ARM build available yet - darwin64 works via Rosetta 2
    url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
    sha256 "c150acf979d2e8d7dfe52c905fa09ad8dc394eca5fb75363333548792d041f77"
  end

  name "RCC"
  desc "RCC - Repeatable Contained Code automation runtime"
  homepage "https://github.com/joshyorko/rcc"
  license "Apache-2.0"

  livecheck do
    url :url
    regex(/^v?(\d+(?:\.\d+)+)$/i)
  end

  binary "rcc-linux64", target: "rcc" if OS.linux?
  binary "rcc-darwin64", target: "rcc" unless OS.linux?

  caveats <<~EOS
    If 'rcc' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.
  EOS
end
