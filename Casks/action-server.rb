cask "action-server" do
  version "1.0.3"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    depends_on arch: :arm64
    on_arm do
      sha256 "720ed3da25311268234dec8bff5710dde21f16e5d2485e03018025d21d93731c"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.0.3/actions-runtime-1.0.3-macos-arm64"
      binary "actions-runtime-1.0.3-macos-arm64", target: "action-server"
    end

  end

  on_linux do
    sha256 "8d07146f7e0ed3be8c7d9e7f7042907b86ad899a4c47d1a755edb98975dc6579"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.0.3/actions-runtime-1.0.3-linux64"
    binary "actions-runtime-1.0.3-linux64", target: "action-server"
  end

  name "Action Server"
  desc "Action Server - Host AI agent actions via HTTP/MCP"
  homepage "https://github.com/joshyorko/actions"

  caveats <<~EOS
    If 'action-server' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.

    Usage:
      action-server --help
      action-server version

    Legacy 1.2.6 installs require: brew reinstall --cask joshyorko/tools/action-server
    Runtime binaries are unsigned; macOS builds are not notarized.
  EOS
end
