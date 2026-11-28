cask "action-server" do
  version "1.1.2"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_linux do
    depends_on arch: :x86_64
    sha256 "7b0e1083306ca70ae5c17f72da5eab5d45c90bd5f0975bb7d5bd44ed1378e630"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.1.2/actions-runtime-1.1.2-linux64"
    binary "actions-runtime-1.1.2-linux64", target: "action-server"
  end

  name "Action Server"
  desc "Action Server - Host AI agent actions via HTTP/MCP (Linux x86-64 only)"
  homepage "https://github.com/joshyorko/actions"

  caveats <<~EOS
    If 'action-server' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.

    Usage:
      action-server --help
      action-server version

    Legacy 1.2.6 installs require: brew reinstall --cask joshyorko/tools/action-server
    Linux x86-64 only. Runtime binaries are unsigned; macOS is not supported by this cask.
  EOS
end
