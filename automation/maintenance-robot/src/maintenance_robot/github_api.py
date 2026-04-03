from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import requests
from packaging.version import InvalidVersion, Version
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

GITHUB_API_ROOT = "https://api.github.com"


class GitHubAPIError(RuntimeError):
    """Raised when GitHub API responses cannot be parsed."""


@dataclass(frozen=True)
class ReleaseInfo:
    tag: str
    version: Version
    sha: Optional[str] = None


def _headers() -> dict[str, str]:
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "homebrew-tools-maintenance-robot",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


@retry(
    wait=wait_exponential(multiplier=1, min=1, max=8),
    stop=stop_after_attempt(4),
    retry=retry_if_exception_type((requests.RequestException, GitHubAPIError)),
)
def _get(url: str, per_page: int = 100, max_pages: int = 3) -> list[dict]:
    all_results: list[dict] = []

    for page in range(1, max_pages + 1):
        paginated_url = f"{url}{'&' if '?' in url else '?'}per_page={per_page}&page={page}"
        response = requests.get(paginated_url, headers=_headers(), timeout=30)
        if response.status_code >= 400:
            raise GitHubAPIError(f"GitHub API error {response.status_code}: {response.text}")
        data = response.json()
        if not isinstance(data, list):
            raise GitHubAPIError("Expected list response from GitHub API")
        if not data:
            break
        all_results.extend(data)

    return all_results


def _normalize_tag(tag: str, sha: Optional[str] = None) -> Optional[ReleaseInfo]:
    if not tag:
        return None

    normalized = tag.strip()
    if normalized.startswith("refs/tags/"):
        normalized = normalized[len("refs/tags/") :]

    try:
        version = Version(normalized.lstrip("v"))
        return ReleaseInfo(tag=normalized, version=version, sha=sha)
    except InvalidVersion:
        logger.debug("Skipping non-semver tag: %s", normalized)
        return None


def _get_tag_sha(repo: str, tag: str) -> Optional[str]:
    url = f"{GITHUB_API_ROOT}/repos/{repo}/git/refs/tags/{tag}"
    response = requests.get(url, headers=_headers(), timeout=30)
    if response.status_code != 200:
        return None

    data = response.json()
    obj = data.get("object", {})
    if obj.get("type") == "commit":
        return obj.get("sha")
    if obj.get("type") != "tag":
        return None

    tag_url = obj.get("url")
    if not tag_url:
        return None

    tag_response = requests.get(tag_url, headers=_headers(), timeout=30)
    if tag_response.status_code != 200:
        return None

    tag_data = tag_response.json()
    return tag_data.get("object", {}).get("sha")


@lru_cache(maxsize=128)
def fetch_latest_version(
    repo: str,
    source: str,
    include_prerelease: bool = False,
    max_major: Optional[int] = None,
    pin_to_sha: bool = True,
) -> Optional[ReleaseInfo]:
    if source not in {"release", "tag"}:
        raise ValueError(f"Unsupported source type: {source}")

    url = f"{GITHUB_API_ROOT}/repos/{repo}/{'releases' if source == 'release' else 'tags'}"
    entries = _get(url)

    for entry in entries:
        tag_name = entry.get("tag_name") if source == "release" else entry.get("name")
        sha = None
        if source == "tag":
            sha = entry.get("commit", {}).get("sha")

        release_info = _normalize_tag(tag_name or "", sha=sha)
        if release_info is None:
            continue
        if max_major is not None and release_info.version.major > max_major:
            continue
        if source == "release" and not include_prerelease and (entry.get("prerelease") or entry.get("draft")):
            continue

        if pin_to_sha and release_info.sha is None:
            sha = _get_tag_sha(repo, release_info.tag)
            if sha:
                release_info = ReleaseInfo(tag=release_info.tag, version=release_info.version, sha=sha)

        return release_info

    return None
