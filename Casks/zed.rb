cask "zed" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.217.3"

  on_macos do
    sha256 arm:   "6f7fcfe96fea6df41f3e3a06d502e6167e762bfa0ad2096b3223960defa5510a",
           intel: "7d5b2a1f3b449ca7f2f4c2a0e0ae3f5144fe59dd61d4b7bf4c66fcd8afc6f6ad"

    url "https://github.com/zed-industries/zed/releases/download/v#{version}/Zed-#{arch}.dmg"

    depends_on macos: ">= :catalina"

    app "Zed.app"
    binary "#{appdir}/Zed.app/Contents/MacOS/cli", target: "zed"

    zap trash: [
      "~/Library/Application Support/Zed",
      "~/Library/Caches/Zed",
      "~/Library/Logs/Zed",
      "~/Library/Preferences/dev.zed.Zed.plist",
      "~/Library/Saved Application State/dev.zed.Zed.savedState",
    ]
  end

  on_linux do
    sha256 arm:          "32a08c4c3dc12ba14dcfe1c23eaa12443425b0c2bdd817a12d1c29d00ea0a5ef",
           x86_64_linux: "2114feb1622b68ebe8675d973d4f0b4775c967cdc5a6fbfc5f73533f050338ed"

    url "https://github.com/zed-industries/zed/releases/download/v#{version}/zed-linux-#{arch}.tar.gz"

    binary "zed.app/bin/zed", target: "zed"
  end

  name "Zed"
  desc "High-performance, multiplayer code editor from the creators of Atom"
  homepage "https://zed.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  caveats <<~EOS
    If 'zed' is not found after installation, refresh your shell's cache:
      hash -r

    Or start a new terminal session.
  EOS
end
