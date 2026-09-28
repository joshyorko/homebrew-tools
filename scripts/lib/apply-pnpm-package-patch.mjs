import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

function readPatchedDependencyPath(workspacePath, packageName, version) {
  const lines = readFileSync(workspacePath, "utf8").split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => line === "patchedDependencies:");
  if (sectionStart === -1) {
    throw new Error(`Missing patchedDependencies in ${workspacePath}`);
  }

  const expectedKey = `${packageName}@${version}`;
  for (const line of lines.slice(sectionStart + 1)) {
    if (/^\S/.test(line)) break;

    const match = line.match(/^  (?:"([^"]+)"|'([^']+)'|([^:]+)):\s*(.+)$/);
    if (!match) continue;

    const key = match[1] ?? match[2] ?? match[3].trim();
    if (key === expectedKey) {
      return match[4].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }

  throw new Error(`Missing pnpm patch for ${expectedKey} in ${workspacePath}`);
}

export function applyPnpmPackagePatch(upstreamDir, nodeModulesDir, packageName, version) {
  const workspacePath = join(resolve(upstreamDir), "pnpm-workspace.yaml");
  const patchPath = join(dirname(workspacePath), readPatchedDependencyPath(workspacePath, packageName, version));
  const packageDir = join(resolve(nodeModulesDir), ...packageName.split("/"));

  if (!existsSync(patchPath)) {
    throw new Error(`Missing pnpm patch file at ${patchPath}`);
  }
  if (!existsSync(join(packageDir, "package.json"))) {
    throw new Error(`Missing installed package ${packageName}@${version} at ${packageDir}`);
  }

  execFileSync("git", ["apply", "-p1", patchPath], {
    cwd: packageDir,
    stdio: "inherit",
  });
}
