cask "action-server" do
  version "1.0.0"

  on_macos do
    on_arm do
      sha256 "b17dde3d64e4088942ef9ead2fd60e17d3cfa091a507db4a3a89eb4de672c322"
      url "https://github.com/joshyorko/actions/releases/download/action-server-v#{version}/action-server-macosarm64"
      binary "action-server-macosarm64", target: "action-server"
    end

    on_intel do
      sha256 "PENDING"
      url "https://github.com/joshyorko/actions/releases/download/action-server-v#{version}/action-server-macos64"
      binary "action-server-macos64", target: "action-server"
    end
  end

  on_linux do
    sha256 "206b09c109cde13bde5757c07f3f2844829d58e82e8263778426aea43bf6833d"
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
