cask "rcc" do
  arch arm: "darwin64", intel: "amd64"
  os macos: "darwin64", linux: "linux64"

  version "18.13.0"
  sha256 arm:          "c150acf979d2e8d7dfe52c905fa09ad8dc394eca5fb75363333548792d041f77",
         intel:        "c150acf979d2e8d7dfe52c905fa09ad8dc394eca5fb75363333548792d041f77",
         x86_64_linux: "11f7f4ed82552971ad0e25772385d659e618fecedfdcd6a8a22b9e78f24bbb8c"

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
