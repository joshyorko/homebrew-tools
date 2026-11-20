# frozen_string_literal: true

cask "chatgpt-linux" do
  arch arm: "aarch64", intel: "x86_64"
  deb_arch = on_arch_conditional arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.1117.31558"
  sha256 arm:          "cf9e48a3a4a5267564e7e0a059161a9acd340791822d5269a6954395b921b452",
       intel:        "9b3f035be1c66471477572d893349e6a20e61ae19641624285e8f4235196b82c",
       arm64_linux:  "cf9e48a3a4a5267564e7e0a059161a9acd340791822d5269a6954395b921b452",
       x86_64_linux: "9b3f035be1c66471477572d893349e6a20e61ae19641624285e8f4235196b82c"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/chatgpt-#{version}/chatgpt-#{version}-1.#{arch}.rpm"
  name "ChatGPT"
  desc "OpenAI's official ChatGPT desktop app"
  homepage "https://chatgpt.com/"

  livecheck do
    url "https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-#{deb_arch}/Packages"
    regex(/^Version:\s*(\d+(?:\.\d+)+)$/i)
  end

  depends_on formula: "cpio"
  depends_on formula: "rpm2cpio"

  binary "usr/lib/chatgpt/codex-launcher", target: "chatgpt"
  artifact "usr/share/applications/chatgpt.desktop",
           target: "#{Dir.home}/.local/share/applications/chatgpt.desktop"
  artifact "usr/share/pixmaps/chatgpt.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png"

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
        -e "s|^Icon=.*|Icon=chatgpt|" \
        "$desktop_file"
    SH
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/chatgpt.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png",
    "#{Dir.home}/.local/share/pixmaps/chatgpt.png",
  ]

  caveats <<~EOS
    Launch ChatGPT with:
      chatgpt

    ChatGPT and Codex user data is left in place when this cask is removed.
  EOS
end
