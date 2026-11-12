cask "action-server" do
  version "1.1.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_linux do
    depends_on arch: :x86_64
    sha256 "e163684dc296f632a177e95d4f355ac6d4f2299c62aab53789f43a642f41c0f1"
    url "https://github.com/joshyorko/actions/releases/download/actions-runtime-1.1.0/actions-runtime-1.1.0-linux64"
    binary "actions-runtime-1.1.0-linux64", target: "action-server"
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
