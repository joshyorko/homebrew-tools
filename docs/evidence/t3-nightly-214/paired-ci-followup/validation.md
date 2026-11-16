# Paired acceptance CI follow-up

Tested fix: `413b5bc0dd42222579a431952ab04ef2382917f8`.

## Exact failed job

[Run 43892181170, job 133387217299](https://github.com/joshyorko/homebrew-tools/actions/runs/43892181170/job/133387217299) failed at PR head `79414929ea614647437fd3cc294345cc26b46a50`. The checkout was GitHub's merge commit `fba26eb0f4522ef30b0aaf3f3ba4d2288618ad36`. The paired source was official nightly `v0.1.10-nightly.20261116.4787`, immutable SHA `b5554ac8114f2ce7ce8b5973690ccb8cbb248efd`.

The CLI/Desktop builds passed. The service-attachment scenario reached `SERVICE_RECOVERY_CONFIRMED`, then reported `Application renderer did not become ready` and hit the outer runner deadline. Its resource report recorded no PID-limit hits or OOM kills.

The service-owner verifier in the maintained service-attach patch accepted only `main.<timestamp>.<sha>` package identities. Consequently it treated the valid nightly pair as incompatible and entered its manual/error recovery path instead of completing automatic pairing. The same failure reproduced locally before the fix.

## Fix and proof

The version gate now also accepts the shipped `<upstream-nightly>.homebrew.<positive-revision>.<sha>` identity. Canonical Cellar paths, owned tap receipts, exact paired identities, full source SHA validation and owner fingerprint revalidation remain required. Nightly source selection, upstream notes/links, updater ownership and lifecycle policy are unchanged.

A new regression executes the actual patched shared module against real fixture files. It failed with the old gate and passes for legacy snapshots, nightly revision 1 and explicit nightly revision 2. Foreign receipts, mismatched source SHAs, stable/preview identities and revision zero remain rejected.

- Tap, patch and GUI-runner suite: 240 passed, zero failed, one existing optional Devsy artifact fixture skipped.
- Rebuilt the Desktop at the exact failed CI nightly/source: 83 source acceptance tests passed; source type-regression gate passed.
- Candidate SHA256: `861b0bef07c8a02a4c8354b5cc9a41f99a53dd96271752d1979d8021b8d70d25`.
- All four real packaged scenarios passed with matching immutable source: service attachment/reconnect, unknown-owner refusal, package-mismatch refusal and manual settings. See [aggregate verdict](acceptance.json) and [attachment preservation report](service-attach.json).

Commands used existing Node 24 and local container authorization from the implementation task:

```sh
export PATH=/home/linuxbrew/.linuxbrew/Cellar/node@24/24.22.3_1/bin:$PATH
node --experimental-strip-types --test dagger/tap-pipeline/tests/*.test.ts scripts/t3-source-patches.test.mjs scripts/t3-homebrew-desktop-e2e/*.test.mjs
dagger -m ./dagger/tap-pipeline --git-dir=/tmp/t3-214-tap.git call -o /tmp/t3-215-nightly.AppImage t-3-code-linux-candidate --github-token=env:GH_TOKEN --t-3-source-ref=b5554ac8114f2ce7ce8b5973690ccb8cbb248efd --t-3-source-version=0.1.10-nightly.20261116.4787.homebrew.1.b5554ac8114f
bash scripts/t3-homebrew-desktop-e2e/run-all.sh /tmp/t3-215-nightly.AppImage /tmp/215-paired-local b5554ac8114f2ce7ce8b5973690ccb8cbb248efd
```

The GitHub credential was supplied as a Dagger secret. GUI verification used isolated synthetic user data, fake Homebrew/systemd metadata, a real packaged service and Desktop, and a network without external routing. The runner removed its own containers, internal networks and image. No shared caches were pruned; no workstation upgrade, merge or release occurred.

## Hosted CI

The original job failed as described above. The repaired PR must pass its new hosted paired-acceptance run; local success is not a claim that the hosted rerun has completed.
