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
      sha256 "ec11807a08b23a098959a717e8011bcb776c56c2f0eaeded80b5a7dc0cb0da3a"
    end
  end

  on_macos do
    on_intel do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
      sha256 "44b1dbf8672bbd307fd44cf4c92f725bbf832f3f1b20b09d007b685a5a484dce"
    end
    # Note: No ARM build available yet - darwin64 works via Rosetta 2
    on_arm do
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-darwin64"
      sha256 "44b1dbf8672bbd307fd44cf4c92f725bbf832f3f1b20b09d007b685a5a484dce"
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
