cask "rcc" do
  arch arm: "darwin64", intel: "amd64"
  os macos: "darwin64", linux: "linux64"

  version "18.13.1"
  sha256 arm:          "3c450ba437394a7b01a32c8465ac1f15624134988d82b18fab370a8fcf4c500b",
         intel:        "3c450ba437394a7b01a32c8465ac1f15624134988d82b18fab370a8fcf4c500b",
         x86_64_linux: "e19dd920e3f2c919a14c242feeb8f897062504c8da4c340a3263a94560cb617f"

  url "https://github.com/joshyorko/rcc/releases/download/v#{version}/rcc-#{os}"
  name "RCC"
  desc "RCC - Repeatable Contained Code automation runtime"
  homepage "https://github.com/joshyorko/rcc"

  binary "rcc-#{os}", target: "rcc"

  caveats <<~EOS
    If 'rcc' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.
  EOS
end
