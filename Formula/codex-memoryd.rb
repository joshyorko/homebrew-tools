class CodexMemoryd < Formula
  desc "Local-first memory daemon for coding agents"
  homepage "https://github.com/joshyorko/codex-memoryd"
  version "0.1.0"
  license "MIT"

  livecheck do
    skip "Pinned to the immutable codex-memoryd v#{version} release."
  end

  on_linux do
    on_intel do
      url "https://github.com/joshyorko/codex-memoryd/releases/download/v#{version}/codex-memoryd-v#{version}-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "2c6d2f1ccab5c1c791a566dba6062e69836175049a8a85d040cd11599a78d0a0"
    end

    on_arm do
      url "https://github.com/joshyorko/codex-memoryd/releases/download/v#{version}/codex-memoryd-v#{version}-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "bd9a98b10c2639a4e56c65fbbedf1aac4aebdbe3a038445bba6df0e672aefe68"
    end
  end

  on_macos do
    on_intel do
      url "https://github.com/joshyorko/codex-memoryd/releases/download/v#{version}/codex-memoryd-v#{version}-x86_64-apple-darwin.tar.gz"
      sha256 "8855d5a0245b702573067293096c5f0d709f6e0fa275aa4e8c1c912775a3da5f"
    end

    on_arm do
      url "https://github.com/joshyorko/codex-memoryd/releases/download/v#{version}/codex-memoryd-v#{version}-aarch64-apple-darwin.tar.gz"
      sha256 "acde8dcfdbc1ca0b18b426288c3efefe93cb69e7444ea3343d2e59c80663c9a9"
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
