cask "action-server" do
  version "1.2.5"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "9197f3edbf83c2517e3ad26580557da81a5c864e96ad2f93e860da6ced909368"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.2.5/action-server-macosarm64"
      binary "action-server-macosarm64", target: "action-server"
    end

  end

  on_linux do
    sha256 "2f0546dd59c77cc6439fe3c843f61843cc25f94ec57c9fdf9e9e7cb99ee6be19"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.2.5/action-server-linux64"
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
