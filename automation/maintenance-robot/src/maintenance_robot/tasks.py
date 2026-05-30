from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from robocorp.tasks import get_current_task, get_output_dir, task

from maintenance_robot.allowlist_loader import load_allowlist
from maintenance_robot.github_actions import GitHubActionsUpdater
from maintenance_robot.reporter import MaintenanceReport

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

PACKAGE_DIR = Path(__file__).resolve().parent
ROBOT_ROOT = Path(os.getenv("ROBOT_ROOT", str(PACKAGE_DIR.parent.parent))).resolve()
REPO_ROOT = ROBOT_ROOT.parent.parent


@task
def maintenance() -> None:
    _run_workflow_updates()


@task
def update_workflows_only() -> None:
    _run_workflow_updates()


def _run_workflow_updates() -> None:
    allowlists_dir = ROBOT_ROOT / "allowlists"
    report = MaintenanceReport()
    workflows_dir = REPO_ROOT / ".github" / "workflows"
    updater = GitHubActionsUpdater(
        load_allowlist(allowlists_dir / "github_actions.json"),
        report=report,
        version_allowlist=load_allowlist(allowlists_dir / "workflow_versions.json"),
    )
    updated_files = updater.update_workflows(workflows_dir)
    if updated_files:
        logging.info("Updated GitHub Actions workflows: %s", ", ".join(sorted(updated_files)))
    else:
        logging.info("GitHub Actions workflows already up to date.")
    _write_report(report)


def _resolve_output_dir() -> Path:
    output_dir = get_output_dir()
    if output_dir is not None:
        return output_dir.resolve()
    return Path(os.getenv("ROBOT_ARTIFACTS", str(ROBOT_ROOT / "output"))).resolve()


def _current_task_name() -> str:
    current_task = get_current_task()
    if current_task is None:
        return "<outside-task>"
    return current_task.name


def _write_report(report: MaintenanceReport) -> None:
    output_dir = _resolve_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "maintenance_report.json"
    report_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    logging.info("Wrote maintenance report for task '%s' to %s", _current_task_name(), report_path)
