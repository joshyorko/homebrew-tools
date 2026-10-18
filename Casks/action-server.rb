cask "action-server" do
  version "1.0.4"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    depends_on arch: :arm64
    on_arm do
      sha256 "cd4a4e93a17b54fbbb085e97ae136d98f0520453c262150ca0903fa73cc0959f"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.0.4/actions-runtime-1.0.4-macos-arm64"
      binary "actions-runtime-1.0.4-macos-arm64", target: "action-server"
    end

  end

  on_linux do
    sha256 "d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.0.4/actions-runtime-1.0.4-linux64"
    binary "actions-runtime-1.0.4-linux64", target: "action-server"
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
