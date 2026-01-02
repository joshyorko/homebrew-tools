class Rcc < Formula
  desc "RCC - Repeatable Contained Code automation runtime with Linux support"
  homepage "https://github.com/joshyorko/rcc"
  version "18.13.0"
  license "Apache-2.0"

  livecheck do
    url :stable
    regex(/^v?(\d+(?:\.\d+)+)$/i)
  end

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-linux64"
      sha256 "11f7f4ed82552971ad0e25772385d659e618fecedfdcd6a8a22b9e78f24bbb8c"
    end
  end

  on_macos do
    on_intel do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
      sha256 "c150acf979d2e8d7dfe52c905fa09ad8dc394eca5fb75363333548792d041f77"
    end
    # Note: No ARM build available yet - darwin64 works via Rosetta 2
    on_arm do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
      sha256 "c150acf979d2e8d7dfe52c905fa09ad8dc394eca5fb75363333548792d041f77"
    end
  end

  def install
    if OS.linux?
      bin.install "rcc-linux64" => "rcc"
    else
      bin.install "rcc-darwin64" => "rcc"
    end
  end

  def caveats
    <<~EOS
      If 'rcc' is not found after installation, refresh your shell's cache:
        hash -r

      Or start a new terminal session.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rcc version")
  end
end
