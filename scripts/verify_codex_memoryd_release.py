#!/usr/bin/env python3
"""Compare tap builds with a separately verified immutable upstream release.

The caller must verify the GitHub release and its signed attestations first.
This script never accesses a registry, creates a release, or edits the formula.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tarfile

TARGETS = (
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
)
MAX_ARCHIVE = 512 * 1024 * 1024


def sha256_file(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_ARCHIVE:
        raise ValueError(f"invalid archive: {path.name}")
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def binary_identity(path):
    with tarfile.open(path, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) != 1:
            raise ValueError("archive must contain exactly one binary")
        member = members[0]
        if not member.isfile() or member.name != "codex-memoryd" or member.mode != 0o755:
            raise ValueError("archive binary metadata is invalid")
        if not 0 < member.size <= MAX_ARCHIVE:
            raise ValueError("archive binary size is invalid")
        hasher = hashlib.sha256()
        with bundle.extractfile(member) as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(chunk)
        return member.size, hasher.hexdigest()


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError(f"invalid provenance: {path.name}")
    result = json.loads(path.read_text())
    if not isinstance(result, dict):
        raise ValueError("provenance must be an object")
    return result


def verify_release(args):
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise ValueError("source commit must be a full lowercase SHA")
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", args.version):
        raise ValueError("release version must be stable")
    if not re.fullmatch(r"[0-9]{14}\.[0-9a-f]{12}", args.build_version) or not args.build_version.endswith(args.commit[:12]):
        raise ValueError("tap version must identify the source commit")
    official_names = {target: f"codex-memoryd-v{args.version}-{target}.tar.gz" for target in TARGETS}
    if {p.name for p in args.official.iterdir()} != set(official_names.values()) | {"SHA256SUMS", "provenance.json"}:
        raise ValueError("upstream release asset set is incomplete or unexpected")
    release = read_json(args.official / "provenance.json")
    identity = {"schema_version": 2, "repository": "joshyorko/codex-memoryd", "commit": args.commit,
                "ref": f"refs/tags/v{args.version}", "package_version": args.version}
    if any(release.get(key) != value for key, value in identity.items()):
        raise ValueError("upstream release source identity mismatch")
    records = release.get("artifacts")
    if not isinstance(records, list) or len(records) != len(TARGETS):
        raise ValueError("upstream release provenance records are incomplete")
    by_target = {}
    for record in records:
        if not isinstance(record, dict) or record.get("target") in by_target:
            raise ValueError("upstream release provenance records are ambiguous")
        by_target[record.get("target")] = record
    if set(by_target) != set(TARGETS):
        raise ValueError("upstream release targets are incomplete")
    sums = {}
    for line in (args.official / "SHA256SUMS").read_text().splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([^/\s]+)", line)
        if not match or match.group(2) in sums:
            raise ValueError("upstream checksum list is malformed or ambiguous")
        sums[match.group(2)] = match.group(1)
    if set(sums) != set(official_names.values()):
        raise ValueError("upstream checksum list has unexpected assets")
    verified = []
    for target, name in official_names.items():
        official = args.official / name
        built = args.built / f"codex-memoryd-{args.build_version}-{target}.tar.gz"
        built_provenance = args.built / f"provenance-{target}.json"
        digest = sha256_file(official)
        record = by_target[target]
        if record.get("name") != name or record.get("sha256") != digest or record.get("size_bytes") != official.stat().st_size or sums[name] != digest:
            raise ValueError(f"upstream archive checksum mismatch: {target}")
        sha256_file(built)
        if binary_identity(official) != binary_identity(built):
            raise ValueError(f"tap build differs from the signed upstream binary: {target}")
        local = read_json(built_provenance)
        expected = {"repository": "joshyorko/codex-memoryd", "ref": "master", "commit": args.commit,
                    "version": args.build_version, "target": target}
        if any(local.get(key) != value for key, value in expected.items()):
            raise ValueError(f"tap build source identity mismatch: {target}")
        verified.append((target, official, built, built_provenance, local, digest))
    # No candidate changes occur until every target has passed all checks.
    for target, official, built, built_provenance, local, digest in verified:
        shutil.copyfile(official, built)
        local.update({"official_release": f"v{args.version}", "official_asset": official.name,
                      "official_archive_sha256": digest,
                      "binary_comparison": "matched independently built tap binary"})
        built_provenance.write_text(json.dumps(local, indent=2, sort_keys=True) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("official", "built"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("commit", "version", "build-version"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    try:
        verify_release(args)
    except (OSError, ValueError, TypeError, KeyError, tarfile.TarError) as error:
        print(f"Homebrew release verification: {error}", file=sys.stderr)
        return 1
    print("All tap binaries match the separately verified upstream release archives.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
