#!/usr/bin/env python3

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import sys
from typing import Iterable


FEATURE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")

CATEGORY_FEATURES = {
    "Voice & conversation": {
        "conversation-mode",
        "global-dictation",
        "read-aloud",
        "read-aloud-mcp",
    },
    "Computer use": {
        "agent-workspace",
        "appshots",
        "x11-ewmh-computer-use",
    },
    "Remote access": {
        "remote-control-ui",
        "remote-mobile-control",
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
        "codex-wrapper-updater",
        "copilot-reasoning-effort",
        "mcp-helper-reaper",
        "node-repl-reaper",
        "open-target-discovery",
        "persistent-status-panel",
        "project-task-sort",
        "record-and-replay",
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
        return {feature_id for feature_id in default_ids if feature_id in features}
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
    return selected


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
    path = Path(config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps({"enabled": sorted(selected)}, indent=2) + "\n")
    os.replace(temporary_path, path)


def selection_argument(selected: set[str]) -> str:
    return ",".join(sorted(selected)) if selected else "none"


def parse_feature_words(value: str) -> set[str]:
    return {item for item in re.split(r"[\s,]+", value.strip()) if item}


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Configure Codex Desktop Linux features for Homebrew")
    parser.add_argument("--features-root", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--full-profile", default="")
    parser.add_argument("--lean-profile", default="")
    parser.add_argument("--result", type=Path)
    parser.add_argument("--print-enabled", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_arguments(argv if argv is not None else sys.argv[1:])
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
    raise NotImplementedError("Interactive wizard is implemented in the next task")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f"codex-desktop-setup: {error}", file=sys.stderr)
        raise SystemExit(1)
