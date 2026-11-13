cask "action-server" do
  version "1.1.1"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_linux do
    depends_on arch: :x86_64
    sha256 "8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.1.1/actions-runtime-1.1.1-linux64"
    binary "actions-runtime-1.1.1-linux64", target: "action-server"
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
