#!/usr/bin/env bash
set -euo pipefail

# Build the latest stable Voxtype/Eitype pair through Dagger and install it
# without relying on a published tap release. This script intentionally keeps
# all generated artifacts in a temporary directory; only the installed
# packages, Voxtype config, Herdr binding, and provenance manifest persist.

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "${script_dir}/.." && pwd -P)
user_home=${HOME:?HOME must be set}
brew_bin=${DICTATION_BREW_BIN:-$(command -v brew || true)}
dagger_bin=${DICTATION_DAGGER_BIN:-$(command -v dagger || true)}
herdr_bin=${DICTATION_HERDR_BIN:-$(command -v herdr || true)}
state_dir=${DICTATION_STATE_DIR:-${XDG_STATE_HOME:-${user_home}/.local/state}/homebrew-tools/dictation}
user_id=$(id -u)
if [[ -z ${XDG_RUNTIME_DIR:-} && -d /run/user/$user_id ]]; then
  export XDG_RUNTIME_DIR=/run/user/$user_id
fi
if [[ -z ${DBUS_SESSION_BUS_ADDRESS:-} && -S /run/user/$user_id/bus ]]; then
  export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$user_id/bus
fi

die() {
  printf 'dictation-install: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name=$1
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: ${command_name}"
}

if [[ $(uname -m) != x86_64 ]]; then
  die "this local artifact is currently built for x86_64 Linux"
fi

if [[ ! -r /etc/os-release ]] || ! grep -Eq '^ID="?bluefin-dakota"?$' /etc/os-release; then
  die "refusing to configure a non-Dakota image; expected ID=bluefin-dakota"
fi

[[ -n $brew_bin && -x $brew_bin ]] || die "Homebrew executable was not found"
[[ -n $dagger_bin && -x $dagger_bin ]] || die "Dagger executable was not found"
[[ -n $herdr_bin && -x $herdr_bin ]] || die "Herdr executable was not found"
require_command python3
require_command sha256sum
require_command systemctl
require_command git
require_command curl
require_command jq
require_command ydotool
require_command wl-copy
require_command gsettings
require_command gnome-extensions

if ! ldconfig -p 2>/dev/null | grep -q 'libxkbcommon\.so\.0' && ! test -e /usr/lib64/libxkbcommon.so.0 && ! test -e /usr/lib/x86_64-linux-gnu/libxkbcommon.so.0; then
  die "Dakota's libxkbcommon runtime is unavailable"
fi

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1

bundle_dir=$(mktemp -d "${TMPDIR:-/tmp}/homebrew-tools-dictation.XXXXXX")
cleanup() {
  rm -rf -- "$bundle_dir"
}
trap cleanup EXIT

printf '%s\n' "Building latest stable Voxtype and Eitype with Dagger..."
git_common_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)
(
  cd "$repo_root"
  "$dagger_bin" -m ./dagger/tap-pipeline call --git-dir="$git_common_dir" -o "$bundle_dir" dictation-bundle
)

manifest_path="$bundle_dir/manifest.json"
[[ -s $manifest_path ]] || die "Dagger did not export manifest.json"
[[ -f $bundle_dir/homebrew/voxtype.rb ]] || die "Dagger did not export the Voxtype formula"
[[ -f $bundle_dir/homebrew/eitype.rb ]] || die "Dagger did not export the Eitype formula"

voxtype_version=
voxtype_artifact=
voxtype_sha256=
eitype_version=
eitype_artifact=
eitype_sha256=

mapfile -t manifest_rows < <(python3 - "$manifest_path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)

if manifest.get("schema_version") != 1 or manifest.get("workflow") != "dakota-local-dictation":
    raise SystemExit("unexpected dictation manifest schema")

packages = manifest.get("packages")
if not isinstance(packages, list):
    raise SystemExit("dictation manifest has no package list")

for package in packages:
    required = ("id", "version", "artifact", "sha256")
    if any(not isinstance(package.get(key), str) or not package[key] for key in required):
        raise SystemExit("dictation manifest contains an incomplete package")
    print("|".join(package[key] for key in required))
PY
)

for row in "${manifest_rows[@]}"; do
  IFS='|' read -r package_id package_version package_artifact package_sha256 <<< "$row"
  case $package_id in
    voxtype)
      voxtype_version=$package_version
      voxtype_artifact=$package_artifact
      voxtype_sha256=$package_sha256
      ;;
    eitype)
      eitype_version=$package_version
      eitype_artifact=$package_artifact
      eitype_sha256=$package_sha256
      ;;
    *)
      die "unexpected package in Dagger manifest: ${package_id}"
      ;;
  esac
done

[[ -n $voxtype_version && -n $voxtype_artifact && -n $voxtype_sha256 ]] || die "Voxtype provenance is incomplete"
[[ -n $eitype_version && -n $eitype_artifact && -n $eitype_sha256 ]] || die "Eitype provenance is incomplete"

artifact_dir="$state_dir/artifacts"
mkdir -p "$artifact_dir"

verify_artifact() {
  local artifact=$1
  local expected_sha256=$2
  local artifact_path="$bundle_dir/artifacts/$artifact"
  [[ -f $artifact_path ]] || die "missing Dagger artifact: ${artifact}"
  printf '%s  %s\n' "$expected_sha256" "$artifact_path" | sha256sum -c - >/dev/null \
    || die "artifact checksum failed: ${artifact}"
}

verify_artifact "$voxtype_artifact" "$voxtype_sha256"
verify_artifact "$eitype_artifact" "$eitype_sha256"

# The Dagger bundle's Voxtype payload is the upstream linux-x86_64-vulkan
# release executable, staged here before Homebrew or the live service changes.
require_command ffprobe
require_command awk
require_command tar
require_command nvidia-smi

backup_dir="$state_dir/backups"
mkdir -p "$backup_dir"

models_dir=${XDG_DATA_HOME:-${user_home}/.local/share}/voxtype/models
whisper_model_name=large-v3-turbo
whisper_model_filename=ggml-large-v3-turbo.bin
whisper_model_path="$models_dir/$whisper_model_filename"
whisper_model_url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$whisper_model_filename"
whisper_model_api="https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main?recursive=false"
whisper_model_manifest="$state_dir/whisper-$whisper_model_name.json"

resolve_whisper_model_metadata() {
  local metadata_path="$bundle_dir/whisper-model-api.json"
  curl --fail --location --retry 4 --retry-all-errors \
    -A "voxtype/${voxtype_version}" "$whisper_model_api" -o "$metadata_path"
  whisper_model_sha256=$(jq -er --arg filename "$whisper_model_filename" \
    '.[] | select(.path == $filename) | .lfs.oid' "$metadata_path") \
    || die "Hugging Face metadata has no LFS SHA-256 for ${whisper_model_filename}"
  whisper_model_size=$(jq -er --arg filename "$whisper_model_filename" \
    '.[] | select(.path == $filename) | .size' "$metadata_path") \
    || die "Hugging Face metadata has no size for ${whisper_model_filename}"
  [[ $whisper_model_sha256 =~ ^[a-f0-9]{64}$ ]] || die "invalid Whisper model SHA-256 metadata"
  [[ $whisper_model_size =~ ^[0-9]+$ ]] || die "invalid Whisper model size metadata"
}

download_whisper_model() {
  resolve_whisper_model_metadata
  if [[ -f $whisper_model_path && -f $whisper_model_manifest ]] \
    && jq -e --arg sha "$whisper_model_sha256" --argjson size "$whisper_model_size" \
      '.sha256 == $sha and .size == $size' "$whisper_model_manifest" >/dev/null \
    && [[ $(stat -c %s "$whisper_model_path") == "$whisper_model_size" ]]; then
    printf '%s\n' "Verified Whisper ${whisper_model_name} model already present."
    return
  fi

  mkdir -p "$models_dir"
  local partial="$whisper_model_path.part"
  printf '%s\n' "Downloading verified Whisper ${whisper_model_name} model (~1.6 GB)..."
  if [[ ! -f $partial || $(stat -c %s "$partial") != "$whisper_model_size" ]]; then
    curl --fail --location --http1.1 --continue-at - --retry 4 --retry-all-errors \
      -A "voxtype/${voxtype_version}" "$whisper_model_url" -o "$partial"
  else
    printf '%s\n' "Found a complete interrupted download; verifying it without re-fetching."
  fi
  [[ $(stat -c %s "$partial") == "$whisper_model_size" ]] \
    || die "Whisper model size mismatch"
  printf '%s  %s\n' "$whisper_model_sha256" "$partial" | sha256sum -c - \
    || die "Whisper model checksum failed"
  [[ $(dd if="$partial" bs=1 count=4 status=none) == "lmgg" ]] \
    || die "Whisper model does not have a GGML header"
  mv -- "$partial" "$whisper_model_path"
  jq -n --arg model "$whisper_model_name" --arg url "$whisper_model_url" \
    --arg sha "$whisper_model_sha256" --argjson size "$whisper_model_size" \
    '{schema_version: 1, engine: "whisper", model: $model, url: $url, sha256: $sha, size: $size}' \
    > "$whisper_model_manifest"
}

patch_whisper_config() {
  local target_config=$1
  python3 - "$target_config" "$whisper_model_path" <<'PY'
import re
import sys
from pathlib import Path

config_path, model_path = map(Path, sys.argv[1:])
lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)

def section_bounds(name):
    start = next((i for i, line in enumerate(lines) if re.match(rf"^\[{re.escape(name)}\]\s*$", line)), None)
    if start is None:
        raise SystemExit(f"Voxtype config has no [{name}] section")
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^\s*\[[^]]+\]\s*$", lines[i])), len(lines))
    return start, end

def set_value(section, key, value):
    start, end = section_bounds(section)
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
    replacement = f"{key} = {value}\n"
    for i in range(start + 1, end):
        if pattern.match(lines[i]):
            lines[i] = replacement
            return
    lines.insert(end, replacement)

engine_line = next((i for i, line in enumerate(lines) if re.match(r"^engine\s*=", line)), None)
if engine_line is None:
    lines.insert(0, 'engine = "whisper"\n')
else:
    lines[engine_line] = 'engine = "whisper"\n'
set_value("whisper", "model", repr(str(model_path)))
set_value("whisper", "mode", '"local"')
set_value("whisper", "language", '"en"')
set_value("whisper", "flash_attention", "true")
set_value("whisper", "gpu_device", "0")
set_value("whisper", "context_window_optimization", "false")
set_value("whisper", "initial_prompt", '"Voxtype, Herdr, Dakota, Bluefin, Codex, Dagger, GNOME, Homebrew, NVIDIA."')
config_path.write_text("".join(lines), encoding="utf-8")
PY
}

stage_vulkan_candidate() {
  local stage_dir=$1
  local candidate_config="$stage_dir/config.toml"
  tar -xzf "$bundle_dir/artifacts/$voxtype_artifact" -C "$stage_dir"
  local candidate_bin="$stage_dir/libexec/voxtype"
  [[ -x $candidate_bin ]] || die "Vulkan candidate binary is missing"
  local gpu_total_mib
  gpu_total_mib=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | tr -d ' ')
  [[ $gpu_total_mib =~ ^[0-9]+$ && $gpu_total_mib -ge 3500 ]] \
    || die "NVIDIA GPU does not expose the required 4 GB memory envelope"
  local vulkan_icd=/usr/share/vulkan/icd.d/nvidia_icd.json
  [[ -r $vulkan_icd ]] || die "NVIDIA Vulkan ICD is unavailable at ${vulkan_icd}"

  if [[ -f $config_path ]]; then
    cp -- "$config_path" "$candidate_config"
  else
    cp -- "$stage_dir/share/voxtype/default.toml" "$candidate_config"
  fi
  patch_whisper_config "$candidate_config"

  local fixture="$bundle_dir/acceptance/speech_long.wav"
  [[ -f $fixture ]] || die "Dagger acceptance fixture is missing"
  local metrics="$stage_dir/metrics"
  local transcript="$stage_dir/transcript"
  local trace="$stage_dir/transcribe.log"
  local elapsed_ms rss_kib candidate_status audio_duration
  read -r elapsed_ms rss_kib candidate_status < <(python3 - "$candidate_bin" "$candidate_config" "$fixture" "$transcript" "$trace" <<'PY'
import os
import resource
import subprocess
import sys
import time

candidate, config, fixture, transcript, trace = sys.argv[1:]
started = time.monotonic()
with open(transcript, "w", encoding="utf-8") as output, open(trace, "w", encoding="utf-8") as errors:
    status = subprocess.run(
        [candidate, "-vv", "-c", config, "transcribe", fixture],
        env={
            **os.environ,
            "VOXTYPE_VULKAN_DEVICE": "nvidia",
            "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/nvidia_icd.json",
        },
        stdout=output,
        stderr=errors,
        check=False,
    ).returncode
elapsed_ms = int((time.monotonic() - started) * 1000)
rss_kib = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
print(elapsed_ms, rss_kib, status)
PY
  )
  [[ $candidate_status == 0 ]] || die "Vulkan candidate transcription failed; see $trace"
  audio_duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$fixture")
  [[ -s $transcript ]] || die "Vulkan candidate returned an empty transcript"
  grep -Eiq 'ggml_vulkan: Found [1-9].*|ggml_vulkan: 0 = .*NVIDIA' "$trace" \
    || die "Vulkan candidate did not prove NVIDIA GPU execution"
  grep -Eiq 'whisper_backend_init_gpu:.*using Vulkan0 backend' "$trace" \
    || die "Vulkan candidate did not select the NVIDIA Vulkan device"
  awk -v elapsed="$elapsed_ms" -v duration="$audio_duration" 'BEGIN { exit !(elapsed < duration * 1000) }' \
    || die "Vulkan candidate is not faster than real time"
  printf '%s\n' "$rss_kib" > "$metrics"
  [[ $rss_kib -lt 4194304 ]] || die "Vulkan candidate exceeded 4 GB resident memory"
  printf '%s\n' "Staged Vulkan candidate passed: ${elapsed_ms}ms for ${audio_duration}s audio."
}

rollback_vulkan_candidate() {
  cp -- "$backup_path" "$config_path"
  systemctl --user daemon-reload
  systemctl --user restart voxtype.service || true
}

install_arc_reactor_hud() {
  local extension_id=voxtype-arc-hud@homebrew-tools.local
  local source_dir="$repo_root/gnome-extension/$extension_id"
  local extension_dir=${XDG_DATA_HOME:-${user_home}/.local/share}/gnome-shell/extensions/$extension_id
  [[ -f $source_dir/metadata.json && -f $source_dir/extension.js && -f $source_dir/stylesheet.css ]] \
    || die "Arc Reactor GNOME extension sources are missing"
  mkdir -p "$extension_dir"
  cp -- "$source_dir/metadata.json" "$source_dir/extension.js" "$source_dir/stylesheet.css" "$extension_dir/"
  if ! gnome-extensions enable "$extension_id"; then
    enabled_extensions=$(gsettings get org.gnome.shell enabled-extensions \
      | python3 -c 'import ast, sys; print(repr(ast.literal_eval(sys.stdin.read())))')
    enabled_extensions=$(printf '%s\n' "$enabled_extensions" \
      | python3 -c 'import ast, sys; values=ast.literal_eval(sys.stdin.read()); item="voxtype-arc-hud@homebrew-tools.local"; values.append(item) if item not in values else None; print(repr(values))')
    gsettings set org.gnome.shell enabled-extensions "$enabled_extensions"
    printf '%s\n' "Arc Reactor HUD installed and queued for the next GNOME session; dictation remains available." >&2
  fi
}

config_dir=${XDG_CONFIG_HOME:-${user_home}/.config}/voxtype
config_path="$config_dir/config.toml"
mkdir -p "$config_dir"
download_whisper_model
stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/homebrew-tools-vulkan.XXXXXX")
stage_vulkan_candidate "$stage_dir"

cp -- "$manifest_path" "$state_dir/manifest.json"
cp -- "$bundle_dir/artifacts/$voxtype_artifact" "$artifact_dir/$voxtype_artifact"
cp -- "$bundle_dir/artifacts/$eitype_artifact" "$artifact_dir/$eitype_artifact"

render_formula() {
  local source_formula=$1
  local destination_formula=$2
  local artifact_path=$3

  python3 - "$source_formula" "$destination_formula" "$artifact_path" <<'PY'
import re
import sys
from pathlib import Path

source_path, destination_path, artifact_path = map(Path, sys.argv[1:])
text = source_path.read_text(encoding="utf-8")

for label in ("url", "version", "sha256"):
    matches = re.findall(rf"^\s*{label}\s+\"[^\"]+\"\s*$", text, re.MULTILINE)
    if len(matches) != 1:
        raise SystemExit(f"formula must contain exactly one {label} stanza")

text = re.sub(
    r"^(\s*url\s+)\"[^\"]+\"\s*$",
    lambda match: f'{match.group(1)}"{artifact_path.resolve().as_uri()}"',
    text,
    count=1,
    flags=re.MULTILINE,
)
destination_path.write_text(text, encoding="utf-8")
PY
}

local_formula_dir="$bundle_dir/local"
mkdir -p "$local_formula_dir"
render_formula "$bundle_dir/homebrew/voxtype.rb" "$local_formula_dir/voxtype.rb" "$artifact_dir/$voxtype_artifact"
render_formula "$bundle_dir/homebrew/eitype.rb" "$local_formula_dir/eitype.rb" "$artifact_dir/$eitype_artifact"

tap_name=local/dictation
if ! "$brew_bin" tap | grep -Fxq "$tap_name"; then
  "$brew_bin" tap-new "$tap_name"
fi
local_tap_dir=$("$brew_bin" --repository "$tap_name")
mkdir -p "$local_tap_dir/Formula"
cp -- "$local_formula_dir/voxtype.rb" "$local_tap_dir/Formula/voxtype.rb"
cp -- "$local_formula_dir/eitype.rb" "$local_tap_dir/Formula/eitype.rb"

version_is_newer() {
  local left=$1
  local right=$2
  [[ $left != "$right" && $(printf '%s\n%s\n' "$left" "$right" | sort -V | tail -n 1) == "$left" ]]
}

install_formula() {
  local package_id=$1
  local target_version=$2
  local formula_path=$3
  local current_version

  current_version=$("$brew_bin" list --versions "$formula_path" 2>/dev/null | awk '{print $NF}' || true)
  if [[ -n $current_version ]] && version_is_newer "$current_version" "$target_version"; then
    printf '%s\n' "Keeping newer installed ${package_id} ${current_version}."
    return
  fi

  if [[ -n $current_version ]]; then
    "$brew_bin" reinstall --formula "$formula_path"
  else
    "$brew_bin" install --formula "$formula_path"
  fi
}

install_formula voxtype "$voxtype_version" "$tap_name/voxtype"
install_formula eitype "$eitype_version" "$tap_name/eitype"
"$brew_bin" test "$tap_name/voxtype"
"$brew_bin" test "$tap_name/eitype"

voxtype_bin=$("$brew_bin" --prefix "$tap_name/voxtype")/bin/voxtype
eitype_bin=$("$brew_bin" --prefix "$tap_name/eitype")/bin/eitype
[[ -x $voxtype_bin ]] || die "Voxtype binary was not linked"
[[ -x $eitype_bin ]] || die "Eitype binary was not linked"

if [[ ! -f $config_path ]]; then
  default_config=$("$brew_bin" --prefix "$tap_name/voxtype")/share/voxtype/default.toml
  [[ -f $default_config ]] || die "Voxtype default config is missing"
  cp -- "$default_config" "$config_path"
fi

backup_dir="$state_dir/backups"
mkdir -p "$backup_dir"
backup_path="$backup_dir/voxtype-config.$(date -u +%Y%m%dT%H%M%SZ).toml"
cp -- "$config_path" "$backup_path"

# config set preserves comments and validates every supported scalar. The
# driver_order key is newer than the v1.0.0 config schema, so it is patched in
# the same atomic transaction below and then validated by the daemon startup.
"$voxtype_bin" config set engine whisper
"$voxtype_bin" config set whisper.model "$whisper_model_path"
"$voxtype_bin" config set whisper.mode local
"$voxtype_bin" config set whisper.language en
"$voxtype_bin" config set whisper.flash_attention true
"$voxtype_bin" config set whisper.gpu_device 0
"$voxtype_bin" config set hotkey.enabled false
"$voxtype_bin" config set hotkey.mode toggle
"$voxtype_bin" config set output.mode type
"$voxtype_bin" config set output.fallback_to_clipboard true
"$voxtype_bin" config set output.auto_submit false
"$voxtype_bin" config set osd.enabled false

config_tmp=$(mktemp "$config_path.tmp.XXXXXX")
python3 - "$config_path" "$config_tmp" <<'PY'
import re
import sys
from pathlib import Path

source_path, destination_path = map(Path, sys.argv[1:])
text = source_path.read_text(encoding="utf-8")
lines = text.splitlines(keepends=True)
output_start = None
output_end = None
for index, line in enumerate(lines):
    match = re.match(r"^\s*\[([^]]+)\]\s*$", line)
    if match:
        if output_start is not None and output_end is None:
            output_end = index
        if match.group(1) == "output":
            output_start = index
if output_start is None:
    raise SystemExit("Voxtype config has no [output] section")
if output_end is None:
    output_end = len(lines)

driver_line = 'driver_order = ["eitype", "ydotool", "clipboard"]\n'
driver_indexes = [
    index for index in range(output_start + 1, output_end)
    if re.match(r"^\s*driver_order\s*=", lines[index])
]
if len(driver_indexes) > 1:
    raise SystemExit("Voxtype config has multiple output.driver_order entries")
if driver_indexes:
    lines[driver_indexes[0]] = driver_line
else:
    mode_indexes = [
        index for index in range(output_start + 1, output_end)
        if re.match(r"^\s*mode\s*=", lines[index])
    ]
    if len(mode_indexes) != 1:
        raise SystemExit("Voxtype config has no unique output.mode entry")
    lines.insert(mode_indexes[0] + 1, driver_line)

destination_path.write_text("".join(lines), encoding="utf-8")
PY
mv -- "$config_tmp" "$config_path"

patch_whisper_config "$config_path"

"$voxtype_bin" setup systemd
voxtype_dropin_dir=${XDG_CONFIG_HOME:-${user_home}/.config}/systemd/user/voxtype.service.d
voxtype_dropin_path=$voxtype_dropin_dir/homebrew-path.conf
brew_bin_dir=$(dirname -- "$brew_bin")
mkdir -p "$voxtype_dropin_dir"
printf '%s\n' \
  '[Service]' \
  "Environment=\"PATH=${brew_bin_dir}:/usr/local/bin:/usr/bin:/snap/bin\"" \
  'Environment=VOXTYPE_VULKAN_DEVICE=nvidia' \
  'Environment=VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json' \
  > "$voxtype_dropin_path"
systemctl --user daemon-reload
systemctl --user enable voxtype.service
if ! systemctl --user restart voxtype.service || ! systemctl --user is-active --quiet voxtype.service; then
  printf '%s\n' "Vulkan service health check failed; restoring the previous Voxtype configuration." >&2
  rollback_vulkan_candidate
  die "Voxtype Vulkan candidate failed post-install health check"
fi
install_arc_reactor_hud

herdr_config=${HERDR_CONFIG_PATH:-${user_home}/.config/herdr/config.toml}
herdr_config_dir=$(dirname -- "$herdr_config")
mkdir -p "$herdr_config_dir"
herdr_backup="$backup_dir/herdr-config.$(date -u +%Y%m%dT%H%M%SZ).toml"
if [[ -f $herdr_config ]]; then
  cp -- "$herdr_config" "$herdr_backup"
else
  : > "$herdr_backup"
fi

herdr_tmp=$(mktemp "$herdr_config.tmp.XXXXXX")
python3 - "$herdr_config" "$herdr_tmp" "$voxtype_bin" <<'PY'
import re
import sys
import tomllib
from pathlib import Path

source_path, destination_path = map(Path, sys.argv[1:3])
voxtype_bin = sys.argv[3]
source = source_path.read_text(encoding="utf-8") if source_path.exists() else ""
if source:
    try:
        parsed = tomllib.loads(source)
    except tomllib.TOMLDecodeError as error:
        raise SystemExit(f"Herdr config is invalid TOML: {error}")
else:
    parsed = {}

expected_key = "prefix+alt+v"
expected_command = f"{voxtype_bin} record toggle"
commands = parsed.get("keys", {}).get("command", [])
if isinstance(commands, dict):
    commands = [commands]
for command in commands:
    if (
        isinstance(command, dict)
        and command.get("key") == expected_key
        and command.get("command") != expected_command
        and not str(command.get("command", "")).endswith("/voxtype record toggle")
    ):
        raise SystemExit(f"Herdr binding {expected_key} is already used by another command")

marker = re.compile(r"(?ms)^# BEGIN homebrew-tools dictation binding\n.*?^# END homebrew-tools dictation binding\n?")
source = marker.sub("", source)
if not any(
    isinstance(command, dict)
    and command.get("key") == expected_key
    and command.get("command") == expected_command
    for command in commands
):
    if source and not source.endswith("\n"):
        source += "\n"
    source += (
        "\n# BEGIN homebrew-tools dictation binding\n"
        "[[keys.command]]\n"
        f'key = "{expected_key}"\n'
        'type = "shell"\n'
        f'command = "{expected_command}"\n'
        "# END homebrew-tools dictation binding\n"
    )

destination_path.write_text(source, encoding="utf-8")
PY
mv -- "$herdr_tmp" "$herdr_config"

# Herdr's binding is convenient in its terminal, but dictation also needs a
# desktop-global trigger for browsers and other GUI applications.
media_keys_schema=org.gnome.settings-daemon.plugins.media-keys
custom_binding_schema=org.gnome.settings-daemon.plugins.media-keys.custom-keybinding
dictation_binding_path=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/dictation/
dictation_binding='<Super><Alt>v'
mapfile -t custom_binding_paths < <(
  gsettings get "$media_keys_schema" custom-keybindings \
    | python3 -c 'import ast, sys; print(*ast.literal_eval(sys.stdin.read()), sep="\n")'
)
for binding_path in "${custom_binding_paths[@]}"; do
  [[ $binding_path == "$dictation_binding_path" ]] && continue
  existing_binding=$(gsettings get "$custom_binding_schema:$binding_path" binding)
  if [[ $existing_binding == "'$dictation_binding'" ]]; then
    die "GNOME shortcut ${dictation_binding} is already used by ${binding_path}"
  fi
done
if [[ ! " ${custom_binding_paths[*]} " =~ " ${dictation_binding_path} " ]]; then
  custom_binding_paths+=("$dictation_binding_path")
fi
custom_binding_list=$(printf '%s\n' "${custom_binding_paths[@]}" \
  | python3 -c 'import sys; print(repr([line.rstrip("\n") for line in sys.stdin if line.strip()]))')
gsettings set "$custom_binding_schema:$dictation_binding_path" name 'Dictation HUD'
gsettings set "$custom_binding_schema:$dictation_binding_path" command "$voxtype_bin record toggle"
gsettings set "$custom_binding_schema:$dictation_binding_path" binding "$dictation_binding"
gsettings set "$media_keys_schema" custom-keybindings "$custom_binding_list"

if "$herdr_bin" status server >/dev/null 2>&1; then
  "$herdr_bin" server reload-config
else
  printf '%s\n' "Herdr server is not running; the binding will load when Herdr starts."
fi

printf '%s\n' "Installed Voxtype ${voxtype_version} (Whisper Vulkan) and Eitype ${eitype_version}."
printf '%s\n' "Hold focus in Herdr and press Ctrl+B, then Alt+V to toggle recording."
printf '%s\n' "Press Super+Alt+V to toggle dictation in any desktop application."
printf '%s\n' "Arc Reactor HUD installed for GNOME Shell."
printf '%s\n' "Provenance saved to ${state_dir}/manifest.json."
