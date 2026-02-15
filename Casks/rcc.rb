cask "rcc" do
  version "18.17.1"

  on_macos do
    on_arm do
      sha256 "fd66169f1e0406e1827c82c6ae1e03c4dd3803f625bae3a7e89bd007f7cc6704"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macosarm64"
      binary "rcc-macosarm64", target: "rcc"
    end

    on_intel do
      sha256 "005a2c39af0550a93ee2e77bd691d9a8c5348eb1dc237ea460996257dfc0bdb7"
      url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-macos64"
      binary "rcc-macos64", target: "rcc"
    end
  end

  on_linux do
    sha256 "228f9c8db0c632d29b42a64a4108e6d99fd5c73d8094cf0dbb0888a448c9c911"
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
