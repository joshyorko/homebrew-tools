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

Artifacts are written to `output/`.
