cask "t3-code-linux" do
  arch intel: "x86_64"
  os linux: "linux"

  version "main.20260709140051.f61fa9499d96"
  sha256 x86_64_linux: "f79482d470fc81845cb35cbdcb2eb8cece984e99fec8fbca936d325cc252b22c"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3-code-linux-main.20260709140051.f61fa9499d96/T3-Code-main.20260709140051.f61fa9499d96-x86_64.AppImage"
  name "T3 Code"
  desc "Minimal GUI for AI code agents"
  homepage "https://t3.codes/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  container type: :naked

  binary "t3-code-linux-wrapper", target: "t3-code-linux"
  artifact "t3-code-linux.desktop",
           target: "#{Dir.home}/.local/share/applications/t3-code-linux.desktop"
  artifact "t3-code-linux.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/512x512/apps"

    appimage = "#{staged_path}/T3-Code-#{version}-#{arch}.AppImage"
    system "chmod", "+x", appimage
    system appimage, "--appimage-extract", chdir: staged_path, out: File::NULL

    desktop_file = "#{staged_path}/t3-code-linux.desktop"
    desktop_source = Dir["#{staged_path}/squashfs-root/*.desktop"].find { |path| File.file?(path) }
    raise "No desktop entry found in extracted T3 Code AppImage" unless desktop_source

    desktop_contents = File.read(desktop_source)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/t3-code-linux %U")
    desktop_contents.gsub!(
      /^Icon=.*/,
      "Icon=#{Dir.home}/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png"
    )
    File.write(desktop_file, desktop_contents)

    icon_source = Dir["#{staged_path}/squashfs-root/usr/share/icons/hicolor/*/apps/*.png"]
      .select { |path| File.file?(path) }
      .max_by { |path| path[%r{/hicolor/(\d+)x\d+/apps/}, 1].to_i }
    icon_source ||= Dir["#{staged_path}/squashfs-root/**/*.png"].find { |path| File.file?(path) }
    raise "No PNG icon found in extracted T3 Code AppImage" unless icon_source

    FileUtils.cp(icon_source, "#{staged_path}/t3-code-linux.png")

    wrapper = "#{staged_path}/t3-code-linux-wrapper"
    File.write(wrapper, <<~SH)
      #!/bin/bash
      path_prepend_if_dir() {
        local dir="$1"
        [ -d "$dir" ] || return 0
        case ":${PATH:-}:" in
          *":$dir:"*) ;;
          *) PATH="$dir${PATH:+:$PATH}" ;;
        esac
      }

      PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}"
      path_prepend_if_dir "#{HOMEBREW_PREFIX}/bin"
      path_prepend_if_dir "#{HOMEBREW_PREFIX}/sbin"
      path_prepend_if_dir "$HOME/.local/bin"
      path_prepend_if_dir "$HOME/bin"
      path_prepend_if_dir "$HOME/.cargo/bin"
      path_prepend_if_dir "$HOME/.deno/bin"
      path_prepend_if_dir "$HOME/.bun/bin"
      path_prepend_if_dir "$HOME/go/bin"
      path_prepend_if_dir "$HOME/.opencode/bin"
      path_prepend_if_dir "$HOME/.local/share/mise/shims"
      export PATH

      exec "#{staged_path}/T3-Code-#{version}-#{arch}.AppImage" --no-sandbox "$@"
    SH
    system "chmod", "+x", wrapper
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/t3-code-linux.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png",
  ]

  caveats <<~EOS
    Launch the app with:
      t3-code-linux

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/t3-code-linux.desktop

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end
