# frozen_string_literal: true

cask "chatgpt-linux" do
  arch arm: "aarch64", intel: "x86_64"
  deb_arch = on_arch_conditional arm: "arm64", intel: "amd64"
  os linux: "linux"

  version "26.930.61225"
  sha256 arm:          "976f3be7946b55af3a6f704d16ea14c105814e20a6e6afa53abb91164cfda94c",
       intel:        "600043b0e7ebb66d96c9c6febd9a3370420270a55adf0b48f7c85aae659559a9",
       arm64_linux:  "976f3be7946b55af3a6f704d16ea14c105814e20a6e6afa53abb91164cfda94c",
       x86_64_linux: "600043b0e7ebb66d96c9c6febd9a3370420270a55adf0b48f7c85aae659559a9"

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
