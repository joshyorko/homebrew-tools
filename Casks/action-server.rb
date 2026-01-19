cask "action-server" do
  version "3.0.0"

  on_macos do
    on_arm do
      sha256 "PENDING_FIRST_RELEASE"
      url "https://github.com/joshyorko/actions/releases/download/action-server-v#{version}/action-server-macosarm64"
      binary "action-server-macosarm64", target: "action-server"
    end

    on_intel do
      sha256 "PENDING_FIRST_RELEASE"
      url "https://github.com/joshyorko/actions/releases/download/action-server-v#{version}/action-server-macos64"
      binary "action-server-macos64", target: "action-server"
    end
  end

  on_linux do
    sha256 "PENDING_FIRST_RELEASE"
    url "https://github.com/joshyorko/actions/releases/download/action-server-v#{version}/action-server-linux64"
    binary "action-server-linux64", target: "action-server"
  end

  name "Action Server"
  desc "Sema4.ai Action Server - Host AI agent actions via HTTP/MCP"
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
