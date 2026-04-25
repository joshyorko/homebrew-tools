cask "action-server" do
  version "1.2.4"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "45de5feb9326c20badd4c17cb2ab6f70e96e047d948aff2d2632795ded3a3ced"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.2.4/action-server-macosarm64"
      binary "action-server-macosarm64", target: "action-server"
    end

  end

  on_linux do
    sha256 "7004e5c2a1a55cbb24f7bfb6c05fae57ae984d34f39482897cebf38a636ef9ad"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.2.4/action-server-linux64"
    binary "action-server-linux64", target: "action-server"
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
  EOS
end
