cask "action-server" do
  version "1.0.1"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    depends_on arch: :arm64
    on_arm do
      sha256 "7e9ea6960107d6f6da6dadd7fd12a2c63f9c065d2a9f296aba765b34d24c47d8"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.0.1/actions-runtime-1.0.1-macos-arm64"
      binary "actions-runtime-1.0.1-macos-arm64", target: "action-server"
    end

  end

  on_linux do
    sha256 "191f40cfebcadbd53bf7b14988098b983b99b4efc1aa8d8ac9e8ada6ad37ab3b"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.0.1/actions-runtime-1.0.1-linux64"
    binary "actions-runtime-1.0.1-linux64", target: "action-server"
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
