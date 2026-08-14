#!/usr/bin/env python3

# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "PyGObject>=3.50",
# ]
# ///

from __future__ import annotations

import argparse
from dataclasses import dataclass
import html
import json
import os
from pathlib import Path
import re
import sys
from typing import Iterable


FEATURE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")

CATEGORY_FEATURES = {
    "Voice & conversation": {
        "global-dictation",
        "read-aloud",
        "read-aloud-mcp",
    },
    "Computer use": {
        "agent-workspace",
        "appshots",
        "computer-use-linux",
    },
    "Remote access": {
        "remote-control-ui",
        "remote-mobile-control",
        "shared-app-server-socket",
    },
    "Capture & memory": {
        "chronicle-skysight",
        "record-and-replay",
    },
    "Appearance": {
        "frameless-titlebar",
        "omarchy-theme",
        "pet-overlay",
        "ui-tweaks",
    },
    "Developer tools": {
        "api-key-model-visibility",
        "api-key-service-tier",
        "authenticated-proxy",
        "automation-extensions",
        "copilot-reasoning-effort",
        "directory-only-working-tree-watch",
        "linux-performance-workarounds",
        "mcp-helper-reaper",
        "node-repl-reaper",
        "persistent-status-panel",
        "project-group-last-updated-sort",
        "project-task-sort",
        "shallow-repository-watches",
    },
    "Hardware & browser integration": {
        "codex-micro",
        "thorium-chrome-plugin",
    },
}


@dataclass(frozen=True)
class Feature:
    id: str
    title: str
    description: str = ""
    requires: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    category: str = "Other"
    local: bool = False


def feature_category(feature_id: str) -> str:
    for category, feature_ids in CATEGORY_FEATURES.items():
        if feature_id in feature_ids:
            return category
    return "Other"


def markup_text(value: str) -> str:
    return html.escape(value, quote=False)


def _read_json(path: Path, label: str):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise
    except Exception as error:
        raise ValueError(f"Could not read {label} at {path}: {error}") from error


def _id_list(value, label: str, manifest_path: Path) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise ValueError(f"Linux feature manifest {manifest_path} field {label} must be an array")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not FEATURE_ID_PATTERN.fullmatch(item):
            raise ValueError(
                f"Linux feature manifest {manifest_path} field {label} contains invalid feature id: {item}"
            )
        if item not in result:
            result.append(item)
    return tuple(result)


def _manifest_paths(root: Path) -> Iterable[tuple[Path, bool]]:
    reserved = {"local", "README.md", "features.example.json", "features.json"}
    if not root.is_dir():
        raise ValueError(f"Linux features root not found: {root}")
    for child in sorted(root.iterdir(), key=lambda item: item.name):
        if child.name.startswith(".") or child.name in reserved or not child.is_dir():
            continue
        manifest = child / "feature.json"
        if manifest.is_file():
            yield manifest, False
    local_root = root / "local"
    if local_root.is_dir():
        for child in sorted(local_root.iterdir(), key=lambda item: item.name):
            if child.name.startswith(".") or not child.is_dir():
                continue
            manifest = child / "feature.json"
            if manifest.is_file():
                yield manifest, True


def discover_features(root: Path) -> dict[str, Feature]:
    features: dict[str, Feature] = {}
    manifest_by_id: dict[str, Path] = {}
    for manifest_path, local in _manifest_paths(Path(root)):
        data = _read_json(manifest_path, "Linux feature manifest")
        if not isinstance(data, dict):
            raise ValueError(f"Linux feature manifest {manifest_path} must be a JSON object")
        feature_id = data.get("id")
        if not isinstance(feature_id, str) or not FEATURE_ID_PATTERN.fullmatch(feature_id):
            raise ValueError(f"Linux feature manifest {manifest_path} has an invalid id")
        if not (manifest_path.parent / "README.md").is_file():
            raise ValueError(f"Linux feature '{feature_id}' must include README.md next to feature.json")
        if data.get("defaultEnabled") is True:
            raise ValueError(f"Linux feature '{feature_id}' must be disabled by default")
        if feature_id in features:
            raise ValueError(
                f"Duplicate Linux feature id '{feature_id}' in {manifest_path} and {manifest_by_id[feature_id]}"
            )
        title = data.get("title") or data.get("name") or feature_id.replace("-", " ").title()
        description = data.get("description") or ""
        features[feature_id] = Feature(
            id=feature_id,
            title=str(title),
            description=str(description),
            requires=_id_list(data.get("requires"), "requires", manifest_path),
            conflicts=_id_list(data.get("conflicts"), "conflicts", manifest_path),
            category=feature_category(feature_id),
            local=local,
        )
        manifest_by_id[feature_id] = manifest_path

    features = dict(sorted(features.items()))
    for feature in features.values():
        for required in feature.requires:
            if required not in features:
                raise ValueError(f"Linux feature '{feature.id}' requires unknown feature '{required}'")
        for conflict in feature.conflicts:
            if conflict not in features:
                raise ValueError(f"Linux feature '{feature.id}' conflicts with unknown feature '{conflict}'")
    return features


def load_selection(
    config_path: Path,
    features: dict[str, Feature],
    default_ids: set[str],
) -> set[str]:
    path = Path(config_path)
    if not path.exists():
        selected = {feature_id for feature_id in default_ids if feature_id in features}
        return _selection_with_requirements(features, selected)
    data = _read_json(path, "Linux feature config")
    if not isinstance(data, dict):
        raise ValueError(f"Linux feature config {path} must be a JSON object")
    enabled = data.get("enabled", [])
    if not isinstance(enabled, list):
        raise ValueError(f"Linux feature config {path} field enabled must be an array")
    selected: set[str] = set()
    for feature_id in enabled:
        if not isinstance(feature_id, str) or not FEATURE_ID_PATTERN.fullmatch(feature_id):
            raise ValueError(f"Invalid Linux feature id in {path}: {feature_id}")
        if feature_id in features:
            selected.add(feature_id)
    return _selection_with_requirements(features, selected)


def _requirements(features: dict[str, Feature], feature_id: str) -> set[str]:
    result: set[str] = set()
    stack = list(features[feature_id].requires)
    while stack:
        required = stack.pop()
        if required in result:
            continue
        result.add(required)
        stack.extend(features[required].requires)
    return result


def _selection_with_requirements(
    features: dict[str, Feature], selected: set[str]
) -> set[str]:
    normalized = set(selected)
    for feature_id in tuple(selected):
        normalized.update(_requirements(features, feature_id))
    return normalized


def _conflict(features: dict[str, Feature], selected: set[str]) -> tuple[str, str] | None:
    for feature_id in sorted(selected):
        for conflict in features[feature_id].conflicts:
            if conflict in selected:
                return feature_id, conflict
    for feature_id in sorted(selected):
        for other_id in sorted(selected):
            if feature_id in features[other_id].conflicts:
                return feature_id, other_id
    return None


def toggle_feature(
    features: dict[str, Feature],
    selected: set[str],
    feature_id: str,
    enabled: bool,
) -> tuple[set[str], str]:
    if feature_id not in features:
        raise ValueError(f"Unknown Linux feature id: {feature_id}")
    original = set(selected)
    updated = set(selected)
    if enabled:
        added_requirements = _requirements(features, feature_id) - updated
        updated.add(feature_id)
        updated.update(added_requirements)
        conflict = _conflict(features, updated)
        if conflict:
            left, right = conflict
            return original, f"{features[left].title} conflicts with {features[right].title}."
        if added_requirements:
            titles = ", ".join(features[item].title for item in sorted(added_requirements))
            return updated, f"Also enabled required feature(s): {titles}."
        return updated, ""

    updated.discard(feature_id)
    removed_dependents: set[str] = set()
    changed = True
    while changed:
        changed = False
        for candidate in tuple(updated):
            if any(required not in updated for required in features[candidate].requires):
                updated.remove(candidate)
                removed_dependents.add(candidate)
                changed = True
    if removed_dependents:
        titles = ", ".join(features[item].title for item in sorted(removed_dependents))
        return updated, f"Also disabled dependent feature(s): {titles}."
    return updated, ""


def save_selection(config_path: Path, selected: set[str]) -> None:
    _write_json_atomic(Path(config_path), {"enabled": sorted(selected)})


def _write_json_atomic(path: Path, data: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(temporary_path, path)


def selection_argument(selected: set[str]) -> str:
    return ",".join(sorted(selected)) if selected else "none"


def _known_metadata(value: object) -> bool:
    return bool(value) and str(value).strip().lower() != "unknown"


def _format_byte_size(value: object) -> str | None:
    try:
        size = int(str(value))
    except (TypeError, ValueError):
        return None
    if size < 0:
        return None
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    amount = float(size)
    unit = units[0]
    for candidate in units:
        unit = candidate
        if amount < 1024 or candidate == units[-1]:
            break
        amount /= 1024
    if unit == "B":
        return f"{size} B"
    return f"{amount:.1f} {unit}"


def build_latest_dmg_summary(pinned: dict, latest: dict) -> dict[str, str]:
    identity_fields = ("contentLength", "lastModified", "etag")
    probe_available = latest.get("probeStatus") == "available" and all(
        _known_metadata(latest.get(field)) for field in identity_fields
    )
    if not probe_available:
        status = "Unable to check newest upstream DMG"
        return {
            "status": status,
            "subtitle": (
                f"{status}\nNo download has started; selecting this still runs drift acceptance"
            ),
        }

    matches_pin = all(
        _known_metadata(pinned.get(field))
        and str(latest[field]).strip() == str(pinned[field]).strip()
        for field in identity_fields
    )
    status = "Matches tested pin" if matches_pin else "Different upstream artifact detected"
    details: list[str] = []
    if matches_pin and _known_metadata(pinned.get("sha256")):
        fingerprint = str(pinned["sha256"]).strip()
        if len(fingerprint) > 16:
            fingerprint = f"{fingerprint[:16]}…"
        details.append(f"SHA256 {fingerprint}")
    formatted_size = _format_byte_size(latest["contentLength"])
    if formatted_size:
        details.append(formatted_size)
    details.append(str(latest["lastModified"]).strip())
    details.append(f"ETag {str(latest['etag']).strip()}")
    return {
        "status": status,
        "subtitle": f"{status}\n{' · '.join(details)}",
    }


def build_latest_dmg_summary_from_args(args: argparse.Namespace) -> dict[str, str]:
    return build_latest_dmg_summary(
        pinned={
            "sha256": args.pinned_dmg_sha256,
            "contentLength": args.pinned_dmg_content_length,
            "lastModified": args.pinned_dmg_last_modified,
            "etag": args.pinned_dmg_etag,
        },
        latest={
            "probeStatus": args.latest_dmg_probe_status,
            "contentLength": args.latest_dmg_content_length,
            "lastModified": args.latest_dmg_last_modified,
            "etag": args.latest_dmg_etag,
        },
    )


def build_result_summary(decision: dict, evidence_dir: Path) -> dict:
    verdict = decision.get("verdict", "inconclusive")
    titles = {
        "accepted": "Newest upstream DMG accepted",
        "accepted_with_warnings": "Accepted with warnings",
        "rejected": "Newest upstream DMG rejected",
        "inconclusive": "DMG compatibility check inconclusive",
    }
    if verdict not in titles:
        verdict = "inconclusive"

    if verdict == "rejected":
        findings = decision.get("blockers", [])
    else:
        findings = decision.get("warnings", [])
    reasons = []
    if isinstance(findings, list):
        for finding in findings:
            if isinstance(finding, dict):
                reason = finding.get("reason") or finding.get("name")
                if reason:
                    reasons.append(str(reason))
            elif finding:
                reasons.append(str(finding))

    defaults = {
        "accepted": "Compatibility checks passed. The selected build may be installed.",
        "accepted_with_warnings": "Compatibility checks passed with non-blocking warnings.",
        "rejected": "The working app was preserved because required compatibility checks failed.",
        "inconclusive": "The working app was preserved because compatibility could not be proven.",
    }
    description = "\n".join(reasons) if reasons else defaults[verdict]
    return {
        "verdict": verdict,
        "title": titles[verdict],
        "description": description,
        "reportPath": Path(evidence_dir) / "upstream-dmg-decision.json",
    }


def write_result(
    result_path: Path,
    action: str,
    selected: set[str],
    dmg_source: str = "pinned",
) -> None:
    if action not in {"save", "install", "cancel"}:
        raise ValueError(f"Unknown setup action: {action}")
    if dmg_source not in {"pinned", "latest"}:
        raise ValueError(f"Unknown DMG source: {dmg_source}")
    features = [] if action == "cancel" else sorted(selected)
    _write_json_atomic(
        Path(result_path),
        {
            "action": action,
            "dmgSource": dmg_source,
            "features": features,
        },
    )


def complete_action(
    action: str,
    config_path: Path,
    result_path: Path,
    selected: set[str],
    dmg_source: str = "pinned",
) -> None:
    if action in {"save", "install"}:
        save_selection(config_path, selected)
    write_result(result_path, action, selected, dmg_source)


def parse_feature_words(value: str) -> set[str]:
    return {item for item in re.split(r"[\s,]+", value.strip()) if item}


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Configure Codex Desktop Linux features for Homebrew")
    parser.add_argument("--features-root", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--full-profile", default="")
    parser.add_argument("--lean-profile", default="")
    parser.add_argument("--result", type=Path)
    parser.add_argument("--conversion-commit", default="unknown")
    parser.add_argument("--official-linux-package", action="store_true")
    parser.add_argument("--pinned-dmg-sha256", default="unknown")
    parser.add_argument("--pinned-dmg-content-length", default="unknown")
    parser.add_argument("--pinned-dmg-last-modified", default="unknown")
    parser.add_argument("--pinned-dmg-etag", default="unknown")
    parser.add_argument("--latest-dmg-probe-status", default="unavailable")
    parser.add_argument("--latest-dmg-content-length", default="unknown")
    parser.add_argument("--latest-dmg-last-modified", default="unknown")
    parser.add_argument("--latest-dmg-etag", default="unknown")
    parser.add_argument("--show-result", type=Path)
    parser.add_argument("--print-enabled", action="store_true")
    return parser.parse_args(argv)


def graphical_session_available() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def gtk_available() -> bool:
    try:
        import gi

        gi.require_version("Gtk", "4.0")
        gi.require_version("Adw", "1")
        from gi.repository import Adw, Gtk  # noqa: F401
    except (ImportError, ValueError):
        return False
    return True


def run_gtk_result(summary: dict) -> int:
    import gi

    gi.require_version("Gtk", "4.0")
    gi.require_version("Adw", "1")
    from gi.repository import Adw, Gio, Gtk

    class ResultApplication(Adw.Application):
        def __init__(self):
            super().__init__(application_id="dev.joshyorko.CodexDesktopBuildResult")

        def do_activate(self):
            window = Adw.ApplicationWindow(application=self)
            window.set_title("Codex Desktop compatibility result")
            window.set_default_size(700, 520)
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
            box.set_margin_top(24)
            box.set_margin_bottom(20)
            box.set_margin_start(28)
            box.set_margin_end(28)
            icons = {
                "accepted": "emblem-ok-symbolic",
                "accepted_with_warnings": "dialog-warning-symbolic",
                "rejected": "dialog-error-symbolic",
                "inconclusive": "dialog-question-symbolic",
            }
            status = Adw.StatusPage(
                title=markup_text(summary["title"]),
                description=markup_text(summary["description"]),
                icon_name=icons[summary["verdict"]],
            )
            status.set_vexpand(True)
            box.append(status)
            report = Gtk.Label(
                label=f"Evidence: {summary['reportPath']}",
                xalign=0,
                wrap=True,
                selectable=True,
            )
            report.add_css_class("dim-label")
            box.append(report)
            actions = Gtk.Box(spacing=8)
            actions.append(Gtk.Box(hexpand=True))
            open_report = Gtk.Button(label="Open report")
            open_report.connect(
                "clicked",
                lambda _button: Gio.AppInfo.launch_default_for_uri(
                    summary["reportPath"].as_uri(),
                    None,
                ),
            )
            close = Gtk.Button(label="Close")
            close.add_css_class("suggested-action")
            close.connect("clicked", lambda _button: self.quit())
            actions.append(open_report)
            actions.append(close)
            box.append(actions)
            window.set_content(box)
            window.present()

    return ResultApplication().run([])


def show_build_result(result_path: Path) -> int:
    result_path = Path(result_path).resolve()
    decision = _read_json(result_path, "upstream DMG decision")
    if not isinstance(decision, dict):
        raise ValueError(f"Upstream DMG decision {result_path} must be a JSON object")
    summary = build_result_summary(decision, result_path.parent)
    if graphical_session_available() and gtk_available():
        return run_gtk_result(summary)
    print(summary["title"])
    print(summary["description"])
    print(f"Evidence: {summary['reportPath']}")
    return 0


def _validated_profile(
    features: dict[str, Feature],
    requested: set[str],
) -> set[str]:
    selected: set[str] = set()
    for feature_id in sorted(requested):
        if feature_id not in features:
            continue
        updated, notice = toggle_feature(features, selected, feature_id, True)
        if updated == selected and "conflicts" in notice:
            raise ValueError(notice)
        selected = updated
    return selected


def _terminal_custom_selection(
    raw: str,
    features: dict[str, Feature],
) -> set[str]:
    requested: set[str] = set()
    feature_ids = list(features)
    for item in re.split(r"[\s,]+", raw.strip()):
        if not item:
            continue
        if item.isdigit():
            index = int(item) - 1
            if index < 0 or index >= len(feature_ids):
                raise ValueError(f"Feature number {item} is out of range 1-{len(feature_ids)}")
            requested.add(feature_ids[index])
        elif item in features:
            requested.add(item)
        else:
            raise ValueError(f"Unknown Linux feature selector: {item}")
    return _validated_profile(features, requested)


def terminal_feature_rows(
    features: dict[str, Feature], selected: set[str], query: str = ""
) -> list[tuple[str, int, bool, str, str, str]]:
    query = query.strip().lower()
    rows = []
    for index, feature in enumerate(features.values(), start=1):
        haystack = f"{feature.category} {feature.id} {feature.title} {feature.description}".lower()
        if query and query not in haystack:
            continue
        rows.append(
            (
                feature.category,
                index,
                feature.id in selected,
                feature.title,
                feature.id,
                feature.description,
            )
        )
    return rows


def _terminal_clear() -> None:
    if sys.stdout.isatty() and os.environ.get("TERM"):
        print("\033[2J\033[H", end="")


def _terminal_print_screen(
    args: argparse.Namespace,
    features: dict[str, Feature],
    selected: set[str],
    query: str,
    notice: str,
) -> None:
    _terminal_clear()
    print("Codex Desktop setup  ·  terminal mode")
    print(f"Conversion: {args.conversion_commit}  ·  {len(selected)}/{len(features)} enabled")
    print("Search: " + (query or "all features"))
    print("─" * 78)
    current_category = None
    rows = terminal_feature_rows(features, selected, query)
    if not rows:
        print("No matching features. Press / to change the search.")
    for category, index, enabled, title, feature_id, description in rows:
        if category != current_category:
            current_category = category
            print(f"\n{category}")
        marker = "✓" if enabled else "·"
        detail = f" — {description}" if description else ""
        print(f"  {index:>2} [{marker}] {title} ({feature_id}){detail}")
    if notice:
        print(f"\n! {notice}")
    print(
        "\nCommands: number toggle · p profile · / search · a all visible · n none "
        "· r review · s save · i build/install · q quit"
    )


def _terminal_toggle_numbers(
    raw: str,
    features: dict[str, Feature],
    selected: set[str],
) -> tuple[set[str], str]:
    feature_ids = list(features)
    updated = set(selected)
    notices = []
    for item in re.split(r"[\s,]+", raw.strip()):
        if not item:
            continue
        if not item.isdigit():
            raise ValueError("Toggle features by number, separated by commas")
        index = int(item) - 1
        if index < 0 or index >= len(feature_ids):
            raise ValueError(f"Feature number {item} is out of range 1-{len(feature_ids)}")
        updated, notice = toggle_feature(features, updated, feature_ids[index], feature_ids[index] not in updated)
        if notice:
            notices.append(notice)
    return updated, " ".join(notices)


def run_terminal_wizard(
    args: argparse.Namespace,
    features: dict[str, Feature],
    selected: set[str],
    full_profile: set[str],
    lean_profile: set[str],
) -> int:
    if not sys.stdin.isatty():
        complete_action("cancel", args.config, args.result, selected)
        print("Codex Desktop setup needs an interactive terminal or graphical session.", file=sys.stderr)
        return 2

    dmg_source = "pinned"
    query = ""
    notice = ""
    while True:
        _terminal_print_screen(args, features, selected, query, notice)
        command = input("\nCommand: ").strip().lower()
        notice = ""
        if not command:
            continue
        if command in {"q", "quit"}:
            complete_action("cancel", args.config, args.result, selected, dmg_source)
            return 0
        if command in {"?", "h", "help"}:
            notice = "Enter a feature number to toggle it; use / for a title/id search."
        elif command in {"/", "search"}:
            query = input("Search text (blank clears): ").strip()
        elif command in {"c", "clear"}:
            query = ""
        elif command in {"p", "profile"}:
            profile = input("Profile: [k]eep [d]aily driver [m]inimal [c]ustom: ").strip().lower()
            if profile in {"d", "daily", "full"}:
                selected = _validated_profile(features, full_profile)
            elif profile in {"m", "minimal", "lean"}:
                selected = _validated_profile(features, lean_profile)
            elif profile not in {"k", "keep", "c", "custom"}:
                notice = "Unknown profile. Choose keep, daily driver, minimal, or custom."
        elif command in {"a", "all"}:
            for _, _, _, _, feature_id, _ in terminal_feature_rows(features, selected, query):
                selected, notice = toggle_feature(features, selected, feature_id, True)
                if "conflicts" in notice:
                    break
        elif command in {"n", "none"}:
            selected = set()
        elif command in {"r", "review"}:
            titles = [features[item].title for item in sorted(selected)]
            notice = "Selected: " + (", ".join(titles) if titles else "no optional features")
        elif command in {"s", "save", "i", "install"}:
            action = "install" if command in {"i", "install"} else "save"
            if action == "install" and not args.official_linux_package:
                latest_dmg_summary = build_latest_dmg_summary_from_args(args)
                print(f"\nNewest upstream DMG: {latest_dmg_summary['subtitle']}")
                source = input("Build source [p]inned tested / [l]atest upstream [p]: ").strip().lower() or "p"
                if source in {"l", "latest"}:
                    dmg_source = "latest"
                elif source not in {"p", "pinned"}:
                    raise ValueError(f"Unknown DMG source choice: {source}")
            complete_action(action, args.config, args.result, selected, dmg_source)
            return 0
        elif command.replace(",", "").replace(" ", "").isdigit():
            selected, notice = _terminal_toggle_numbers(command, features, selected)
        else:
            notice = "Unknown command. Use ? for help."


def run_gtk_wizard(
    args: argparse.Namespace,
    features: dict[str, Feature],
    initial_selected: set[str],
    full_profile: set[str],
    lean_profile: set[str],
) -> int:
    import gi

    gi.require_version("Gtk", "4.0")
    gi.require_version("Adw", "1")
    from gi.repository import Adw, Gio, Gtk

    class WizardApplication(Adw.Application):
        def __init__(self):
            super().__init__(application_id="dev.joshyorko.CodexDesktopSetup")
            self.selected = set(initial_selected)
            self.dmg_source = "pinned"
            self.completed = False
            self.rows: dict[str, Adw.SwitchRow] = {}
            self.groups: dict[str, Adw.PreferencesGroup] = {}
            self.updating = False

        def do_activate(self):
            self.window = Adw.ApplicationWindow(application=self)
            self.window.set_title("Codex Desktop Setup")
            self.window.set_default_size(900, 720)
            self.window.connect("close-request", self.on_close)

            toolbar = Adw.ToolbarView()
            header = Adw.HeaderBar()
            header.set_title_widget(
                Adw.WindowTitle(
                    title="Codex Desktop Setup",
                    subtitle=f"Homebrew build · {args.conversion_commit[:12]}",
                )
            )
            toolbar.add_top_bar(header)

            self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.SLIDE_LEFT_RIGHT)
            self.toast_overlay = Adw.ToastOverlay(child=self.stack)
            toolbar.set_content(self.toast_overlay)
            self.stack.add_named(self.build_features_page(), "features")
            self.stack.add_named(self.build_review_page(), "review")
            self.window.set_content(toolbar)
            self.window.present()

        def build_features_page(self):
            page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
            page.set_margin_top(20)
            page.set_margin_bottom(16)
            page.set_margin_start(28)
            page.set_margin_end(28)

            title = Gtk.Label(label="Choose what Codex Desktop includes", xalign=0)
            title.add_css_class("title-1")
            page.append(title)
            subtitle = Gtk.Label(
                label="Pick a profile or tune individual Linux features. Requirements are handled automatically.",
                xalign=0,
                wrap=True,
            )
            subtitle.add_css_class("dim-label")
            page.append(subtitle)

            profile_box = Gtk.Box(spacing=8)
            daily = Gtk.ToggleButton(label="Daily driver")
            minimal = Gtk.ToggleButton(label="Minimal")
            custom = Gtk.ToggleButton(label="Custom")
            minimal.set_group(daily)
            custom.set_group(daily)
            profile_box.append(daily)
            profile_box.append(minimal)
            profile_box.append(custom)
            profile_box.append(Gtk.Box(hexpand=True))
            self.count_label = Gtk.Label(xalign=1)
            self.count_label.add_css_class("dim-label")
            profile_box.append(self.count_label)
            page.append(profile_box)

            daily.connect("toggled", self.on_profile, "daily", full_profile)
            minimal.connect("toggled", self.on_profile, "minimal", lean_profile)
            custom.connect("toggled", self.on_profile, "custom", None)
            self.custom_button = custom
            if self.selected == _validated_profile(features, full_profile):
                daily.set_active(True)
            elif self.selected == _validated_profile(features, lean_profile):
                minimal.set_active(True)
            else:
                custom.set_active(True)

            search = Gtk.SearchEntry(placeholder_text="Search features")
            search.connect("search-changed", self.on_search)
            page.append(search)

            preferences = Adw.PreferencesPage()
            for category in CATEGORY_FEATURES:
                self.add_category(preferences, category)
            self.add_category(preferences, "Other")

            scroller = Gtk.ScrolledWindow(vexpand=True, child=preferences)
            scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
            page.append(scroller)

            actions = Gtk.Box(spacing=8)
            cancel = Gtk.Button(label="Cancel")
            cancel.connect("clicked", lambda _button: self.finish("cancel"))
            save = Gtk.Button(label="Save for later")
            save.connect("clicked", lambda _button: self.finish("save"))
            review = Gtk.Button(label="Review")
            review.add_css_class("suggested-action")
            review.connect("clicked", self.show_review)
            actions.append(cancel)
            actions.append(Gtk.Box(hexpand=True))
            actions.append(save)
            actions.append(review)
            page.append(actions)
            self.refresh_rows()
            return page

        def add_category(self, preferences, category):
            group = Adw.PreferencesGroup(title=markup_text(category))
            self.groups[category] = group
            for feature in features.values():
                if feature.category != category:
                    continue
                suffixes = []
                if feature.requires:
                    suffixes.append(
                        "Requires " + ", ".join(features[item].title for item in feature.requires)
                    )
                if feature.conflicts:
                    suffixes.append(
                        "Conflicts with " + ", ".join(features[item].title for item in feature.conflicts)
                    )
                subtitle = feature.description
                if suffixes:
                    subtitle = f"{subtitle} · {' · '.join(suffixes)}" if subtitle else " · ".join(suffixes)
                row = Adw.SwitchRow(
                    title=markup_text(feature.title),
                    subtitle=markup_text(subtitle),
                )
                row.set_name(feature.id)
                row.connect("notify::active", self.on_feature_toggled, feature.id)
                self.rows[feature.id] = row
                group.add(row)
            if any(feature.category == category for feature in features.values()):
                preferences.add(group)

        def on_profile(self, button, profile_name, profile_ids):
            if not button.get_active() or self.updating or profile_ids is None:
                return
            self.selected = _validated_profile(features, set(profile_ids))
            self.refresh_rows()
            self.toast_overlay.add_toast(Adw.Toast(title=f"{profile_name.title()} profile selected"))

        def on_feature_toggled(self, row, _parameter, feature_id):
            if self.updating:
                return
            updated, notice = toggle_feature(features, self.selected, feature_id, row.get_active())
            self.selected = updated
            self.custom_button.set_active(True)
            self.refresh_rows()
            if notice:
                self.toast_overlay.add_toast(Adw.Toast(title=notice))

        def refresh_rows(self):
            self.updating = True
            try:
                for feature_id, row in self.rows.items():
                    row.set_active(feature_id in self.selected)
                self.count_label.set_label(f"{len(self.selected)} selected")
            finally:
                self.updating = False

        def on_search(self, entry):
            query = entry.get_text().strip().lower()
            for category, group in self.groups.items():
                visible = False
                for feature in features.values():
                    if feature.category != category:
                        continue
                    haystack = f"{feature.id} {feature.title} {feature.description}".lower()
                    matches = not query or query in haystack
                    self.rows[feature.id].set_visible(matches)
                    visible = visible or matches
                group.set_visible(visible)

        def build_review_page(self):
            page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
            page.set_margin_top(32)
            page.set_margin_bottom(24)
            page.set_margin_start(40)
            page.set_margin_end(40)
            title = Gtk.Label(label="Review your Homebrew build", xalign=0)
            title.add_css_class("title-1")
            page.append(title)
            self.review_summary = Gtk.Label(xalign=0, wrap=True, selectable=True)
            page.append(self.review_summary)
            source_group = Adw.PreferencesGroup(title="Build source")
            if args.official_linux_package:
                source_group.add(Adw.ActionRow(
                    title="Official signed Linux package",
                    subtitle="Verified package from OpenAI's stable Linux repository",
                ))
                page.append(source_group)
            else:
                self.add_dmg_source_rows(source_group)
                page.append(source_group)
            note = Adw.StatusPage(
                title="Your running app stays untouched",
                description="Build &amp; install uses the existing safety guard and refuses to replace a live Codex Desktop bundle.",
                icon_name="security-high-symbolic",
            )
            note.set_vexpand(True)
            page.append(note)
            actions = Gtk.Box(spacing=8)
            back = Gtk.Button(label="Back")
            back.connect("clicked", lambda _button: self.stack.set_visible_child_name("features"))
            save = Gtk.Button(label="Save only")
            save.connect("clicked", lambda _button: self.finish("save"))
            install = Gtk.Button(label="Build & install")
            install.add_css_class("suggested-action")
            install.connect("clicked", lambda _button: self.finish("install"))
            actions.append(back)
            actions.append(Gtk.Box(hexpand=True))
            actions.append(save)
            actions.append(install)
            page.append(actions)
            return page

        def add_dmg_source_rows(self, source_group):
            pinned_fingerprint = args.pinned_dmg_sha256
            if len(pinned_fingerprint) > 16:
                pinned_fingerprint = f"{pinned_fingerprint[:16]}…"
            pinned = Adw.ActionRow(
                title="Tested pinned DMG",
                subtitle=(
                    f"Recommended · SHA256 {pinned_fingerprint} · "
                    f"{args.pinned_dmg_last_modified}"
                ),
            )
            pinned_choice = Gtk.CheckButton()
            pinned_choice.set_active(True)
            pinned.add_suffix(pinned_choice)
            pinned.set_activatable_widget(pinned_choice)
            latest_dmg_summary = build_latest_dmg_summary_from_args(args)
            latest = Adw.ActionRow(
                title="Newest upstream DMG",
                subtitle=latest_dmg_summary["subtitle"],
            )
            latest.set_subtitle_lines(2)
            latest.set_subtitle_selectable(True)
            latest_choice = Gtk.CheckButton()
            latest_choice.set_group(pinned_choice)
            latest.add_suffix(latest_choice)
            latest.set_activatable_widget(latest_choice)
            pinned_choice.connect("toggled", self.on_dmg_source_toggled, "pinned")
            latest_choice.connect("toggled", self.on_dmg_source_toggled, "latest")
            source_group.add(pinned)
            source_group.add(latest)

        def on_dmg_source_toggled(self, button, dmg_source):
            if button.get_active():
                self.dmg_source = dmg_source

        def show_review(self, _button):
            titles = [features[item].title for item in sorted(self.selected)]
            feature_text = "\n".join(f"• {title}" for title in titles) if titles else "No optional features"
            self.review_summary.set_label(
                f"Conversion commit\n{args.conversion_commit}\n\n"
                f"Build source\n"
                f"{'Official signed Linux package' if args.official_linux_package else ('Tested pinned DMG' if self.dmg_source == 'pinned' else 'Newest upstream DMG')}\n\n"
                f"Enabled features ({len(self.selected)})\n{feature_text}"
            )
            self.stack.set_visible_child_name("review")

        def finish(self, action):
            complete_action(
                action,
                args.config,
                args.result,
                self.selected,
                self.dmg_source,
            )
            self.completed = True
            self.quit()

        def on_close(self, _window):
            if not self.completed:
                complete_action("cancel", args.config, args.result, self.selected)
                self.completed = True
            return False

    application = WizardApplication()
    return application.run([])


def run_wizard(args: argparse.Namespace) -> int:
    features = discover_features(args.features_root)
    full_profile = parse_feature_words(args.full_profile)
    lean_profile = parse_feature_words(args.lean_profile)
    selected = load_selection(args.config, features, full_profile)
    if graphical_session_available():
        if gtk_available():
            return run_gtk_wizard(args, features, selected, full_profile, lean_profile)
        print(
            "Codex Desktop graphical setup is unavailable because the selected "
            "Python cannot load the GTK 4/libadwaita Python bindings. Install the "
            "native bindings for this device or set CODEX_DESKTOP_SETUP_PYTHON to "
            "a system Python that provides them; using the terminal wizard instead.",
            file=sys.stderr,
        )
    return run_terminal_wizard(args, features, selected, full_profile, lean_profile)


def main(argv: list[str] | None = None) -> int:
    args = parse_arguments(argv if argv is not None else sys.argv[1:])
    if args.show_result is not None:
        return show_build_result(args.show_result)
    if args.config is None:
        raise ValueError("--config is required")
    if args.print_enabled:
        if not args.config.exists():
            return 0
        data = _read_json(args.config, "Linux feature config")
        enabled = data.get("enabled", []) if isinstance(data, dict) else []
        if not isinstance(enabled, list):
            raise ValueError(f"Linux feature config {args.config} field enabled must be an array")
        print(selection_argument({str(item) for item in enabled}))
        return 0
    if args.features_root is None or args.result is None:
        raise ValueError("--features-root and --result are required for interactive setup")
    return run_wizard(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f"codex-desktop-setup: {error}", file=sys.stderr)
        raise SystemExit(1)
