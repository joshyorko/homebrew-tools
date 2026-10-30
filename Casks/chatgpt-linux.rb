# frozen_string_literal: true

cask "chatgpt-linux" do
  arch arm: "aarch64", intel: "x86_64"
  deb_arch = on_arch_conditional arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.1027.30824"
  sha256 arm:          "07768d648e630f37eb8457dde2f07a1e0aa676d2895835d8b5c8148f6727de45",
       intel:        "c45045bef9cff939ff97797fb7b451ae7c5e499f321c02723d94395cf227dc86",
       arm64_linux:  "07768d648e630f37eb8457dde2f07a1e0aa676d2895835d8b5c8148f6727de45",
       x86_64_linux: "c45045bef9cff939ff97797fb7b451ae7c5e499f321c02723d94395cf227dc86"

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
