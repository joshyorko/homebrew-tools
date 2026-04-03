from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from packaging.version import InvalidVersion, Version
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from .github_api import ReleaseInfo, fetch_latest_version
from .reporter import GitHubActionUpdate, MaintenanceReport

logger = logging.getLogger(__name__)

ACTION_REF_PATTERN = re.compile(
    r"^(?P<action>[^@]+)@(?P<ref>[a-f0-9]{40}|[^\s#]+)(?:\s*#\s*(?P<comment>.*))?$"
)


@dataclass
class UpdateResult:
    value: str
    comment: Optional[str] = None


class GitHubActionsUpdater:
    def __init__(self, allowlist: dict[str, dict[str, object]], report: MaintenanceReport) -> None:
        self.allowlist = allowlist
        self.report = report
        self._release_cache: dict[str, Optional[ReleaseInfo]] = {}
        self.yaml = YAML()
        self.yaml.preserve_quotes = True
        self.yaml.width = 1000

    def update_workflows(self, workflows_dir: Path) -> set[str]:
        updated_files: set[str] = set()
        for path in self._iter_workflow_files(workflows_dir):
            if self._update_workflow(path):
                updated_files.add(str(path.relative_to(workflows_dir.parent)))
        return updated_files

    def _iter_workflow_files(self, workflows_dir: Path):
        for extension in ("*.yml", "*.yaml"):
            yield from workflows_dir.glob(extension)

    def _update_workflow(self, path: Path) -> bool:
        data = self.yaml.load(path.read_text(encoding="utf-8"))
        changed = False

        def walk(node: Any) -> None:
            nonlocal changed
            if isinstance(node, CommentedMap):
                for key in list(node.keys()):
                    value = node[key]
                    if key == "uses" and isinstance(value, str):
                        result = self._maybe_update_uses(value, path, self._existing_eol_comment(node, key))
                        if result and result.value != value:
                            node[key] = result.value
                            if result.comment:
                                node.yaml_add_eol_comment(result.comment, key)
                            changed = True
                    else:
                        walk(value)
            elif isinstance(node, CommentedSeq):
                for item in node:
                    walk(item)

        walk(data)

        if changed:
            with path.open("w", encoding="utf-8") as stream:
                self.yaml.dump(data, stream)

        return changed

    @staticmethod
    def _existing_eol_comment(node: CommentedMap, key: Any) -> Optional[str]:
        comment_entry = node.ca.items.get(key)
        if not comment_entry or len(comment_entry) < 3 or comment_entry[2] is None:
            return None

        raw = comment_entry[2].value.strip()
        if raw.startswith("#"):
            raw = raw[1:].strip()
        return raw or None

    def _maybe_update_uses(self, value: str, path: Path, existing_comment: Optional[str] = None) -> Optional[UpdateResult]:
        original = value.strip()
        if "@" not in original or original.startswith(("./", "../", "docker://")):
            return None

        match = ACTION_REF_PATTERN.match(original)
        if not match:
            return None

        action = match.group("action")
        ref = match.group("ref").strip()
        comment_version = match.group("comment") or existing_comment

        action_parts = action.split("/")
        if len(action_parts) < 2:
            return None
        base_action = f"{action_parts[0]}/{action_parts[1]}"
        if base_action not in self.allowlist:
            return None

        release = self._get_release(base_action)
        if release is None:
            return None

        is_sha_pinned = len(ref) == 40 and all(char in "0123456789abcdef" for char in ref.lower())
        if is_sha_pinned:
            current_version = self._to_version((comment_version or "").strip())
            if release.sha and ref.lower() == release.sha.lower():
                return None
            current_display = f"{ref[:7]} # {comment_version or 'unknown'}"
        else:
            current_version = self._to_version(ref)
            current_display = ref

        if current_version is None:
            logger.debug("Skipping non-version reference %s in %s", ref, path)
            return None

        needs_sha_pinning = release.sha is not None and not is_sha_pinned
        has_newer_version = release.version > current_version

        if not has_newer_version and not needs_sha_pinning:
            return None
        if not has_newer_version and needs_sha_pinning and release.version != current_version:
            return None

        if release.sha:
            new_value = f"{action}@{release.sha}"
            version_comment = release.tag
            updated_display = f"{release.sha[:7]} # {release.tag}"
        else:
            new_value = f"{action}@{release.tag}"
            version_comment = None
            updated_display = release.tag

        if original == new_value or original == f"{new_value} # {version_comment}":
            return None

        logger.info("Updating %s: %s -> %s", path, original, updated_display)
        self.report.add_action_update(
            GitHubActionUpdate(file=path, action=action, previous=current_display, updated=updated_display)
        )
        return UpdateResult(value=new_value, comment=version_comment)

    @staticmethod
    def _to_version(ref: str) -> Optional[Version]:
        trimmed = ref.strip()
        if not trimmed:
            return None
        if trimmed.startswith("refs/tags/"):
            trimmed = trimmed[len("refs/tags/") :]
        if trimmed.startswith("v"):
            trimmed = trimmed[1:]
        try:
            return Version(trimmed)
        except InvalidVersion:
            return None

    def _get_release(self, action: str) -> Optional[ReleaseInfo]:
        if action not in self._release_cache:
            config = self.allowlist.get(action, {})
            repo = str(config.get("repo", ""))
            if not repo:
                self._release_cache[action] = None
            else:
                self._release_cache[action] = fetch_latest_version(
                    repo=repo,
                    source=str(config.get("source", "release")),
                    include_prerelease=bool(config.get("include_prerelease", False)),
                    max_major=int(config["max_major"]) if "max_major" in config else None,
                    pin_to_sha=bool(config.get("pin_to_sha", True)),
                )
        return self._release_cache[action]
