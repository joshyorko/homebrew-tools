class CodexMemoryd < Formula
  desc "Local-first memory daemon for coding agents"
  homepage "https://github.com/joshyorko/codex-memoryd"
  version "20261014222239.79a279d5f730"
  license "MIT"

  livecheck do
    skip "Tap auto-update tracks merged master commits."
  end

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "dacd1489f6358231077a03cfc2f84d05600a391702c4ec95857c1277e439ffdd"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "c36be511d83bfca1d7afc6e491b196d625c73dd898dffa394b183c50b52c0f22"
    end
  end

  on_macos do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-x86_64-apple-darwin.tar.gz"
      sha256 "54e853721a11366b1b740ff366d9a0f24f9701b1c70dd1a202f97e00f29056ea"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-aarch64-apple-darwin.tar.gz"
      sha256 "6e58453409cddfe018e952fff17c00528d936fc5c91fa1067965f0cc147b7498"
    end
  end

  def install
    bin.install "codex-memoryd"
  end

  test do
    ENV["HOME"] = (testpath/"home").to_s
    ENV["CODEX_MEMORYD_HOME"] = (testpath/"runtime").to_s
    system bin/"codex-memoryd", "--version"
    begin
      system bin/"codex-memoryd", "init", "--bind", "127.0.0.1:8989"
      system bin/"codex-memoryd", "up"
      assert_match '"ok":true', shell_output("#{bin}/codex-memoryd status")
    ensure
      system bin/"codex-memoryd", "down"
    end
    assert_path_exists testpath/"runtime/memory.db"
  end

  def caveats
    <<~EOS
      codex-memoryd keeps its configuration and database in ~/.codex-memoryd.
      Homebrew upgrades and uninstalls do not remove that persistent data.
    EOS
  end
end
