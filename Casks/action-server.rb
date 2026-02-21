cask "action-server" do
  version "1.2.3"

  on_macos do
    on_arm do
      sha256 "acc587599ce966e9ddd57d301b0d385dd1b0700455caf85d6bcd8697b16cdb96"
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
    sha256 "f0f1c0856e429445d06d33823196a1fed358979c04dc82769592e85c1190c10b"
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
