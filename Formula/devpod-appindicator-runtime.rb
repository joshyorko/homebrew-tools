require "tmpdir"
class DevpodAppindicatorRuntime < Formula
  desc "Lightweight AppIndicator runtime libraries for DevPod Desktop"
  homepage "https://github.com/skevetter/devpod"
  url "https://archive.ubuntu.com/ubuntu/pool/main/liba/libayatana-appindicator/libayatana-appindicator3-1_0.5.90-7ubuntu2_amd64.deb"
  sha256 "e66308d293448b6f0384ae6d20b04f6c1a1172d2738da570ce585a574f8cbba9"
  license "LGPL-2.1-or-later"

  keg_only "provides private runtime libraries for devpod-linux"

  depends_on :linux

  resource "libayatana-indicator3-7" do
    url "https://archive.ubuntu.com/ubuntu/pool/main/liba/libayatana-indicator/libayatana-indicator3-7_0.9.1-1_amd64.deb"
    sha256 "27d7fb04242fa4a2157cc0cd8f0c4154965edc8eb4916843f199d9f8e4a5d33e"
  end

  resource "libayatana-ido3-0.4-0" do
    url "https://archive.ubuntu.com/ubuntu/pool/main/a/ayatana-ido/libayatana-ido3-0.4-0_0.9.1-1_amd64.deb"
    sha256 "0c1c8eb17cba75494f7e79082e02576fe882ee618f52fb69f27b4826eeb38df2"
  end

  resource "libdbusmenu-glib4" do
    url "https://archive.ubuntu.com/ubuntu/pool/main/libd/libdbusmenu/libdbusmenu-glib4_16.04.1+18.10.20180917-0ubuntu8_amd64.deb"
    sha256 "638cb5a015487c9e92f7983ec60946586eb7f8aad70d7767d2e063f469229bff"
  end

  resource "libdbusmenu-gtk3-4" do
    url "https://archive.ubuntu.com/ubuntu/pool/main/libd/libdbusmenu/libdbusmenu-gtk3-4_16.04.1+18.10.20180917-0ubuntu8_amd64.deb"
    sha256 "c1db54b87b88a7e5046d75e44b47f49cdaf0faeed1c2b7cc0f0344d130610d7d"
  end

  def install
    odie "devpod-appindicator-runtime is currently x86_64-only" unless Hardware::CPU.intel?

    lib.mkpath

    extract_from_deb(cached_download, "libayatana-appindicator3.so.1*")
    extract_from_resource("libayatana-indicator3-7", "libayatana-indicator3.so.7*")
    extract_from_resource("libayatana-ido3-0.4-0", "libayatana-ido3-0.4.so.0*")
    extract_from_resource("libdbusmenu-glib4", "libdbusmenu-glib.so.4*")
    extract_from_resource("libdbusmenu-gtk3-4", "libdbusmenu-gtk3.so.4*")

    # DevPod falls back to libappindicator names on some builds.
    ln_sf "libayatana-appindicator3.so.1", lib/"libappindicator3.so.1"
    ln_sf "libayatana-appindicator3.so.1", lib/"libappindicator3.so"
    ln_sf "libayatana-appindicator3.so.1", lib/"libayatana-appindicator3.so"
  end

  test do
    assert_path_exists lib/"libayatana-appindicator3.so.1"
    assert_predicate lib/"libappindicator3.so.1", :symlink?

    ldd_output = shell_output("LD_LIBRARY_PATH='#{lib}' ldd '#{lib}/libayatana-appindicator3.so.1' 2>&1")
    refute_match(/not found/, ldd_output)
  end

  private

  def extract_from_resource(resource_name, pattern)
    resource(resource_name).fetch
    extract_from_deb(resource(resource_name).cached_download, pattern)
  end

  def extract_from_deb(deb_path, pattern)
    Dir.mktmpdir("devpod-appindicator-runtime") do |dir|
      cp deb_path, "#{dir}/pkg.deb"
      Dir.chdir(dir) do
        system "ar", "x", "pkg.deb"
      end

      data_archive = Dir["#{dir}/data.tar.*"].first
      odie "unable to find data archive in #{deb_path}" if data_archive.blank?

      case data_archive
      when /\.tar\.gz$/
        system "tar", "-xzf", data_archive, "-C", dir
      when /\.tar\.xz$/
        system "tar", "-xJf", data_archive, "-C", dir
      when /\.tar\.zst$/
        system "sh", "-c", "unzstd -c '#{data_archive}' | tar -xf - -C '#{dir}'"
      else
        system "tar", "-xf", data_archive, "-C", dir
      end

      Dir["#{dir}/usr/lib/x86_64-linux-gnu/#{pattern}"].each do |source|
        cp source, lib
      end
    end
  end
end
