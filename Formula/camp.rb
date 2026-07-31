class Camp < Formula
  desc "Recoverable capsule workspaces"
  homepage "https://github.com/joshyorko/camp"
  version "0.1.0"

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/joshyorko/camp/releases/download/v0.1.0/camp_0.1.0_linux_arm64.tar.gz"
      sha256 "0606f679f44bfcb072a4fc83512441482a7b1e36cf50d09cffa855036473119a"
    else
      url "https://github.com/joshyorko/camp/releases/download/v0.1.0/camp_0.1.0_linux_amd64.tar.gz"
      sha256 "a3428463ee31b379b6051e71d558f668df83696264d3118006f099584f8adf85"
    end
  end

  depends_on "passt"

  def install
    bin.install "camp"
    bash_completion.install "completions/camp.bash" => "camp"
    zsh_completion.install "completions/_camp"
    fish_completion.install "completions/camp.fish"
  end

  test do
    system "#{bin}/camp", "--version"
    system "#{bin}/camp", "--help"
  end
end
