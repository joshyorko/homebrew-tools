"""Tests use only synthetic release archives and temporary directories."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

import verify_codex_memoryd_release as verify

COMMIT = "a" * 40
RELEASE = "0.1.1"
BUILD = "20261029120000.aaaaaaaaaaaa"


def make_archive(path, content):
    with tarfile.open(path, "w:gz") as bundle:
        info = tarfile.TarInfo("codex-memoryd")
        info.mode = 0o755
        info.size = len(content)
        bundle.addfile(info, io.BytesIO(content))


class OfficialReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.official = self.root / "official"
        self.built = self.root / "built"
        self.official.mkdir()
        self.built.mkdir()
        records = []
        lines = []
        for target in verify.TARGETS:
            name = f"codex-memoryd-v{RELEASE}-{target}.tar.gz"
            official = self.official / name
            built = self.built / f"codex-memoryd-{BUILD}-{target}.tar.gz"
            make_archive(official, target.encode())
            make_archive(built, target.encode())
            digest = hashlib.sha256(official.read_bytes()).hexdigest()
            records.append(dict(name=name, target=target, sha256=digest, size_bytes=official.stat().st_size))
            lines.append(f"{digest}  {name}\n")
            (self.built / f"provenance-{target}.json").write_text(json.dumps(dict(
                repository="joshyorko/codex-memoryd", ref="master", commit=COMMIT,
                version=BUILD, target=target)))
        (self.official / "SHA256SUMS").write_text("".join(lines))
        (self.official / "provenance.json").write_text(json.dumps(dict(
            repository="joshyorko/codex-memoryd", ref=f"refs/tags/v{RELEASE}",
            commit=COMMIT, package_version=RELEASE, schema_version=2, artifacts=records)))
        self.args = argparse.Namespace(official=self.official, built=self.built,
                                       commit=COMMIT, version=RELEASE, build_version=BUILD)

    def test_reuses_exact_verified_upstream_archive_bytes(self):
        verify.verify_release(self.args)
        for target in verify.TARGETS:
            original = self.official / f"codex-memoryd-v{RELEASE}-{target}.tar.gz"
            copied = self.built / f"codex-memoryd-{BUILD}-{target}.tar.gz"
            self.assertEqual(copied.read_bytes(), original.read_bytes())
            record = json.loads((self.built / f"provenance-{target}.json").read_text())
            self.assertEqual(record["official_release"], f"v{RELEASE}")
            self.assertEqual(record["official_archive_sha256"], hashlib.sha256(original.read_bytes()).hexdigest())

    def test_rejects_mismatched_binary_without_copying_any_archive(self):
        target = verify.TARGETS[-1]
        candidate = self.built / f"codex-memoryd-{BUILD}-{target}.tar.gz"
        make_archive(candidate, b"different binary")
        first = self.built / f"codex-memoryd-{BUILD}-{verify.TARGETS[0]}.tar.gz"
        before = first.read_bytes()
        with self.assertRaises(ValueError):
            verify.verify_release(self.args)
        self.assertEqual(first.read_bytes(), before)

    def test_rejects_wrong_source_or_tampered_official_archive(self):
        path = self.official / "provenance.json"
        original = path.read_text()
        altered = json.loads(original)
        altered["commit"] = "b" * 40
        path.write_text(json.dumps(altered))
        with self.assertRaises(ValueError):
            verify.verify_release(self.args)
        path.write_text(original)
        archive = self.official / f"codex-memoryd-v{RELEASE}-{verify.TARGETS[0]}.tar.gz"
        archive.write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            verify.verify_release(self.args)

    def test_rejects_wrong_tap_identity_and_unexpected_assets(self):
        self.args.build_version = "20261029120000.bbbbbbbbbbbb"
        with self.assertRaises(ValueError):
            verify.verify_release(self.args)
        self.args.build_version = BUILD
        (self.official / "unexpected.txt").write_text("unexpected")
        with self.assertRaises(ValueError):
            verify.verify_release(self.args)

    def test_rejects_tap_build_with_wrong_source_identity(self):
        path = self.built / f"provenance-{verify.TARGETS[0]}.json"
        record = json.loads(path.read_text())
        record["commit"] = "b" * 40
        path.write_text(json.dumps(record))
        with self.assertRaises(ValueError):
            verify.verify_release(self.args)


if __name__ == "__main__":
    unittest.main()
