cask "action-server" do
  version "1.2.6"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  on_macos do
    on_arm do
      sha256 "6c431ca22900fc4a0b7a39cfd4e2e58534375df42e7c865237614c87843219ba"
      url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.2.6/action-server-macosarm64"
      binary "action-server-macosarm64", target: "action-server"
    end

  end

  on_linux do
    sha256 "efb57b88a225e62478567a35ea9c424083be1fc56246b8403e643c250eedc21e"
    url "https://github.com/joshyorko/homebrew-tools/releases/download/action-server-1.2.6/action-server-linux64"
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
