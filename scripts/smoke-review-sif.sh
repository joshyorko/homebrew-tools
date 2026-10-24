#!/usr/bin/env bash
set -euo pipefail
sif="${1:?usage: smoke-review-sif.sh /absolute/review.sif}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home/.omp/profiles/review-candidate/agent"
cat > "$work/home/.omp/profiles/review-candidate/agent/models.yml" <<'YAML'
providers:
  local-probe:
    baseUrl: http://127.0.0.1:43127/v1
    apiKey: candidate-probe
    api: openai-completions
    models:
      - id: deterministic
        name: Candidate probe
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
YAML
# Unsquash avoids requiring /dev/fuse; namespace and runtime failures are fatal.
apptainer exec --unsquash "$sif" /usr/bin/omp --version
printf '%s\n' '{"id":"commands","type":"get_available_commands"}' |
  timeout --signal=TERM --kill-after=5s 60s \
  apptainer exec --unsquash --containall --home "$work/home:/home/review" \
    --env REVIEW_DEFAULT_SCOPE=example/repo --env REVIEW_MODE=review \
    "$sif" /usr/bin/omp --profile review-candidate \
    --extension /usr/share/review/extension --extension /usr/share/review/luna-factory \
    --mode rpc-ui --no-skills --no-rules --no-pty --model local-probe/deterministic \
    > "$work/coload.jsonl" 2>&1 || { cat "$work/coload.jsonl" >&2; exit 1; }
cat "$work/coload.jsonl"
grep -Fq '"statusKey":"review_workbench"' "$work/coload.jsonl"
grep -Fq '"name":"factory"' "$work/coload.jsonl"
