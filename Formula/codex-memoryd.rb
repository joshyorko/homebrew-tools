class CodexMemoryd < Formula
  desc "Local-first memory daemon for coding agents"
  homepage "https://github.com/joshyorko/codex-memoryd"
  version "20261014222239.79a279d5f730"
  license "MIT"

  livecheck do
    skip "Tap auto-update tracks approved released master commits."
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
    require "net/http"
    require "socket"

    ENV["CODEX_MEMORYD_HOME"] = (testpath/"runtime").to_s
    system bin/"codex-memoryd", "--version"
    listener = TCPServer.new("127.0.0.1", 0)
    port = listener.addr[1]
    listener.close
    bind = "127.0.0.1:#{port}"
    system bin/"codex-memoryd", "init", "--bind", bind
    pid = spawn (bin/"codex-memoryd").to_s, "--db", (testpath/"runtime/memory.db").to_s,
                "serve", "--bind", bind, out: File::NULL, err: File::NULL
    reaped = false
    begin
      response = nil
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 20
      while Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
        if Process.waitpid(pid, Process::WNOHANG)
          reaped = true
          raise "foreground MemoryD exited before the health check"
        end
        begin
          http = Net::HTTP.new("127.0.0.1", port, nil)
          http.open_timeout = http.read_timeout = 1
          response = http.get("/healthz")
          break if response.code == "200"
        rescue Errno::ECONNREFUSED, Errno::ECONNRESET, Net::OpenTimeout, Net::ReadTimeout, IOError
          # Wait only for the owned foreground process to become ready.
        end
        sleep 0.1
      end
      assert response, "foreground MemoryD health check timed out"
      assert_equal "200", response.code
      assert_match(/"ok"\s*:\s*true/, response.body)
    ensure
      unless reaped
        begin
          if Process.waitpid(pid, Process::WNOHANG).nil?
            Process.kill("TERM", pid)
            50.times do
              if Process.waitpid(pid, Process::WNOHANG)
                reaped = true
                break
              end
              sleep 0.1
            end
            unless reaped
              Process.kill("KILL", pid)
              Process.waitpid(pid)
            end
          end
        rescue Errno::ESRCH, Errno::ECHILD
          # The child has exited; do not signal any PID from a state file.
        end
      end
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
