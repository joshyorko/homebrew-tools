from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class GitHubActionUpdate:
    file: Path
    action: str
    previous: str
    updated: str

    def to_dict(self) -> dict[str, str]:
        return {
            "file": str(self.file),
            "action": self.action,
            "previous": self.previous,
            "updated": self.updated,
        }


@dataclass
class MaintenanceReport:
    github_actions: list[GitHubActionUpdate] = field(default_factory=list)

    def add_action_update(self, update: GitHubActionUpdate) -> None:
        self.github_actions.append(update)

    def to_dict(self) -> dict[str, list[dict[str, str]]]:
        return {
            "github_actions": [item.to_dict() for item in self.github_actions],
        }
