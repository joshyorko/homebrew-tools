#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

const modulePath = "./dagger/tap-pipeline"
const sourceRef = "0123456789012345678901234567890123456789"
const sourceVersion = "main.012345678901"

function checkCall(args, expectedUsage, expectedArguments) {
  const output = execFileSync(
    "dagger",
    ["--silent", "-m", modulePath, "call", ...args, "--help"],
    { encoding: "utf8" },
  )

  assert.ok(output.includes(expectedUsage), `expected generated CLI usage ${expectedUsage}`)
  for (const argument of expectedArguments) {
    assert.ok(output.includes(argument), `expected generated CLI argument ${argument}`)
  }
}

checkCall(
  ["resolve-t-3-source", "--github-token=env://GH_TOKEN"],
  "dagger call resolve-t-3-source",
  ["--github-token Secret"],
)

for (const packageId of ["t3code-cli-main", "t3-code-linux"]) {
  for (const command of ["release-bundle", "ci-check"]) {
    checkCall(
      [
        command,
        `--package-id=${packageId}`,
        `--t-3-source-ref=${sourceRef}`,
        `--t-3-source-version=${sourceVersion}`,
      ],
      `dagger call ${command}`,
      [
        "--package-id string",
        "--t-3-source-ref string",
        "--t-3-source-version string",
      ],
    )
  }
}
