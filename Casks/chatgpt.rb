# frozen_string_literal: true

cask "chatgpt" do
  arch arm: "aarch64", intel: "x86_64"
  deb_arch = on_arch_conditional arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.908.31748"
  sha256 arm:          "396ca608b882678cc81a91f5fe0e1976ef62e81585ac8f05742d58ebba15a783",
       intel:        "75e76b4ec65f1343567e93a2625416c2209e3930052218a5df1d92e00be41c62",
       arm64_linux:  "396ca608b882678cc81a91f5fe0e1976ef62e81585ac8f05742d58ebba15a783",
       x86_64_linux: "75e76b4ec65f1343567e93a2625416c2209e3930052218a5df1d92e00be41c62"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/chatgpt-#{version}/chatgpt-#{version}-1.#{arch}.rpm"
  name "ChatGPT"
  desc "OpenAI's official ChatGPT desktop app"
  homepage "https://chatgpt.com/"

  livecheck do
    url "https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-#{deb_arch}/Packages"
    regex(/^Version:\s*(\d+(?:\.\d+)+)$/i)
  end

  auto_updates true
  depends_on formula: "cpio"
  depends_on formula: "rpm2cpio"

  binary "usr/lib/chatgpt/codex-launcher", target: "chatgpt"
  artifact "usr/share/applications/chatgpt.desktop",
           target: "#{Dir.home}/.local/share/applications/chatgpt.desktop"
  artifact "usr/share/pixmaps/chatgpt.png",
           target: "#{Dir.home}/.local/share/pixmaps/chatgpt.png"

  preflight_steps do
    run "{{HOMEBREW_PREFIX}}/bin/rpm2cpio",
        args: ["{{staged_path}}/chatgpt-{{version}}-1.{{arch}}.rpm"],
        stdout_path: "chatgpt.cpio"
    run "{{HOMEBREW_PREFIX}}/bin/cpio",
        args: ["-idm", "--quiet"],
        stdin_path: "chatgpt.cpio",
        chdir: "{{staged_path}}"
    remove "chatgpt-{{version}}-1.{{arch}}.rpm"
    remove "chatgpt.cpio"

    run "/bin/bash", args: ["-eu", "-c", <<~'SH'], chdir: "{{staged_path}}"
      desktop_file="usr/share/applications/chatgpt.desktop"
      /bin/sed -i \
        -e "s|^Exec=.*|Exec={{HOMEBREW_PREFIX}}/bin/chatgpt %U|" \
        -e "s|^Icon=.*|Icon=$HOME/.local/share/pixmaps/chatgpt.png|" \
        "$desktop_file"
    SH
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/chatgpt.desktop",
    "#{Dir.home}/.local/share/pixmaps/chatgpt.png",
  ]

  caveats <<~EOS
    Launch ChatGPT with:
      chatgpt

    ChatGPT and Codex user data is left in place when this cask is removed.
  EOS
end
