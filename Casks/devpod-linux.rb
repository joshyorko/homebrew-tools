cask "devpod-linux" do
  arch intel: "amd64"
  os linux: "linux"

  version "0.12.15"
  sha256 x86_64_linux: "39e12877a972d958dfa324adb0920091e3fd4075a1aea3146141b12e48a54a5e"

  url "https://github.com/skevetter/devpod/releases/download/v#{version}/DevPod_#{os}_#{arch}.deb",
      verified: "github.com/skevetter/devpod/"
  name "DevPod"
  desc "Open-source dev environments based on devcontainer.json"
  homepage "https://github.com/skevetter/devpod"

  livecheck do
    url :url
    strategy :github_latest
  end

  binary "usr/bin/devpod"
  binary "devpod-desktop-wrapper", target: "devpod-desktop"
  artifact "usr/share/applications/DevPod.desktop",
           target: "#{Dir.home}/.local/share/applications/devpod.desktop"
  artifact "usr/share/icons/hicolor/32x32/apps/DevPod Desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/32x32/apps/devpod-desktop.png"
  artifact "usr/share/icons/hicolor/128x128/apps/DevPod Desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod-desktop.png"
  artifact "usr/share/icons/hicolor/256x256@2/apps/DevPod Desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png"

  preflight do
    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/32x32/apps"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/256x256@2/apps"

    deb = Dir["#{staged_path}/DevPod_*_*.deb"].first
    raise "unable to find DevPod .deb in #{staged_path}" if deb.blank?

    system "ar", "x", deb, chdir: staged_path

    data_archive = Dir["#{staged_path}/data.tar.*"].first
    raise "unable to find data archive in #{deb}" if data_archive.blank?

    case data_archive
    when /\.tar\.gz$/
      system "tar", "-xzf", data_archive, "-C", staged_path
    when /\.tar\.xz$/
      system "tar", "-xJf", data_archive, "-C", staged_path
    when /\.tar\.zst$/
      system "sh", "-c", "unzstd -c '#{data_archive}' | tar -xf - -C '#{staged_path}'"
    else
      system "tar", "-xf", data_archive, "-C", staged_path
    end

    desktop_file = "#{staged_path}/usr/share/applications/DevPod.desktop"
    desktop_contents = File.read(desktop_file)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/devpod-desktop")
    icon_path = "#{Dir.home}/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png"
    desktop_contents.gsub!(/^Icon=.*/, "Icon=#{icon_path}")
    File.write(desktop_file, desktop_contents)

    wrapper = "#{staged_path}/devpod-desktop-wrapper"
    File.write(wrapper, <<~SH)
      #!/bin/sh
      APPINDICATOR_LIB="#{HOMEBREW_PREFIX}/opt/libayatana-appindicator/lib"
      if [ -f "$APPINDICATOR_LIB/libayatana-appindicator3.so.1" ]; then
        export LD_LIBRARY_PATH="$APPINDICATOR_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      fi
      exec "#{staged_path}/usr/bin/DevPod Desktop" "$@"
    SH
    FileUtils.chmod "+x", wrapper
  end

  zap trash: [
    "~/.cache/sh.loft.devpod",
    "~/.config/sh.loft.devpod",
    "~/.devpod",
    "~/.local/share/sh.loft.devpod",
  ]

  caveats <<~EOS
    Provider setup (validated against DevPod v0.12.15):

    Works by short name:
      devpod provider add docker
      devpod provider add kubernetes
      devpod provider add aws -o AWS_REGION=us-east-1
      devpod provider add gcloud -o PROJECT=<gcp-project-id>
      devpod provider add ssh -o HOST=<host-or-ip>

    Some list-available entries currently 404 by short name. Use explicit source:
      devpod provider add loft-sh/devpod-provider-azure
      devpod provider add loft-sh/devpod-provider-digitalocean
      devpod provider add loft-sh/devpod-provider-terraform
      devpod provider add loft-sh/devpod-provider-civo
      devpod provider add loft-sh/devpod-provider-ecs
      devpod provider add loft-sh/devpod-provider-dockerless

    Discover provider names:
      devpod provider list-available

    UI dependency note:
      If DevPod UI fails with a missing libayatana-appindicator error, install one of:
        brew install libayatana-appindicator
        rpm-ostree install libayatana-appindicator-gtk3
  EOS
end
