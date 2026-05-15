#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const scriptPath = "/tap/scripts/patch-codex-desktop-conversion.mjs"

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }

    args[key] = value
    index += 1
  }

  return args
}

function replaceOnce(contents, search, replacement, label) {
  if (contents.includes(replacement)) {
    return contents
  }

  if (!contents.includes(search)) {
    throw new Error(`Could not find ${label}`)
  }

  return contents.replace(search, replacement)
}

function patchFile(path, patcher) {
  const before = readFileSync(path, "utf8")
  const after = patcher(before)

  if (after !== before) {
    writeFileSync(path, after)
  }
}

function patchBetterSqlite3Source(moduleDir) {
  const root = resolve(moduleDir)
  const betterSqlite = join(root, "src/better_sqlite3.cpp")
  const macros = join(root, "src/util/macros.cpp")
  const helpers = join(root, "src/util/helpers.cpp")

  for (const path of [betterSqlite, macros, helpers]) {
    if (!existsSync(path)) {
      throw new Error(`Missing better-sqlite3 source file: ${path}`)
    }
  }

  patchFile(betterSqlite, (contents) =>
    replaceOnce(
      contents,
      "\tv8::Local<v8::External> data = v8::External::New(isolate, addon);",
      [
        "\t#if defined(V8_MAJOR_VERSION) && V8_MAJOR_VERSION >= 14",
        "\tv8::Local<v8::External> data = v8::External::New(isolate, addon, v8::kExternalPointerTypeTagDefault);",
        "\t#else",
        "\tv8::Local<v8::External> data = v8::External::New(isolate, addon);",
        "\t#endif",
      ].join("\n"),
      "better-sqlite3 External::New call",
    ),
  )

  patchFile(macros, (contents) =>
    replaceOnce(
      contents,
      "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())",
      [
        "#if defined(V8_MAJOR_VERSION) && V8_MAJOR_VERSION >= 14",
        "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value(v8::kExternalPointerTypeTagDefault))",
        "#else",
        "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())",
        "#endif",
      ].join("\n"),
      "better-sqlite3 External::Value call",
    ),
  )

  patchFile(helpers, (contents) =>
    replaceOnce(
      contents,
      ["\t\tfunc,", "\t\t0,", "\t\tdata"].join("\n"),
      ["\t\tfunc,", "\t\tnullptr,", "\t\tdata"].join("\n"),
      "better-sqlite3 SetNativeDataProperty setter argument",
    ),
  )
}

function patchConversionNativeModules(conversionDir) {
  const nativeModules = join(resolve(conversionDir), "scripts/lib/native-modules.sh")

  if (!existsSync(nativeModules)) {
    throw new Error(`Missing upstream native module script: ${nativeModules}`)
  }

  patchFile(nativeModules, (contents) => {
    const hook = `    node "${scriptPath}" --better-sqlite3-dir "$build_dir/node_modules/better-sqlite3" 2>&1 >&2`
    if (contents.includes(hook)) {
      return contents
    }

    const needle = '    npm install "better-sqlite3@$bs3_build_ver" "node-pty@$npty_ver" --ignore-scripts 2>&1 >&2'
    if (!contents.includes(needle)) {
      throw new Error("Could not find upstream better-sqlite3 npm install step")
    }

    return contents.replace(needle, `${needle}\n${hook}`)
  })
}

const args = parseArgs(process.argv.slice(2))

if (args["better-sqlite3-dir"]) {
  patchBetterSqlite3Source(args["better-sqlite3-dir"])
} else if (args["conversion-dir"]) {
  patchConversionNativeModules(args["conversion-dir"])
} else {
  throw new Error(
    "Usage: patch-codex-desktop-conversion.mjs --conversion-dir <upstream-repo> | --better-sqlite3-dir <module-dir>",
  )
}
