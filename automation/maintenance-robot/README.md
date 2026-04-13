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
default `github.token` is not sufficient for pushes or PR creation. Configure these repository
secrets for the workflow:

- `MAINTENANCE_APP_ID`
- `MAINTENANCE_APP_PRIVATE_KEY`

The backing GitHub App must be installed on this repository with at least these repository
permissions:

- Contents: Read and write
- Pull requests: Read and write
- Workflows: Read and write

Artifacts are written to `output/`.
