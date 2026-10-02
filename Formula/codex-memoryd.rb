class CodexMemoryd < Formula
  desc "Local-first memory daemon for coding agents"
  homepage "https://github.com/joshyorko/codex-memoryd"
  version "20261002154623.8146e6bd4bfe"
  license "MIT"

  livecheck do
    skip "Tap auto-update tracks merged master commits."
  end

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "89539833250adb996f97dfefe7b2731c89f08ab57454e9f2ad35fe360bae0785"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "a0b8b5038e357235c2cc88d48d6a3a8016b40d7b5a965a457a2c89ed4fd21801"
    end
  end

  on_macos do
    on_intel do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-x86_64-apple-darwin.tar.gz"
      sha256 "d15798c99f09afcd3f827cbda62e5da146064914186c69778ac76d018adbc4df"
    end

    on_arm do
      url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-aarch64-apple-darwin.tar.gz"
      sha256 "9db31c6f644af69440fd642551fee4c9bc0aac50e370164467d91b99844217ba"
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
