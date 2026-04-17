# Maintenance Robot

RCC-powered maintenance robot for this tap.

This robot is intentionally narrow. It updates GitHub Actions workflow references that
we explicitly allowlist and writes a maintenance report. It does not try to mutate tap
packages, release metadata, or arbitrary downloads.

## Tasks

- `maintenance`: update workflow action refs and write a report
- `update-workflows`: targeted workflow update run

## Local Usage

```bash
rcc ht vars -r automation/maintenance-robot/robot.yaml
rcc run -r automation/maintenance-robot/robot.yaml -t update-workflows --silent
```

## GitHub Actions Setup

The scheduled `RCC Maintenance` workflow updates files under `.github/workflows/`, so the
default `github.token` is not sufficient for pushes or PR creation. Configure this repository
secret for the workflow:

- `GH_PAT`

The token behind `GH_PAT` must be able to:

- push commits that modify `.github/workflows/*`
- create pull requests in this repository
- call the GitHub API for the maintenance robot

In practice that means either:

- a classic PAT with at least `repo` and `workflow` scopes, or
- a fine-grained token with `Contents: Read and write`, `Pull requests: Read and write`, and `Workflows: Read and write`

Artifacts are written to `output/`.
