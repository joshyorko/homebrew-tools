import ts from "../dagger/tap-pipeline/node_modules/typescript/lib/typescript.js"
import { posix } from "node:path"

const printer = ts.createPrinter({ removeComments: true })
const pipeline = "dagger/tap-pipeline/src/index.ts"

// Specialize only explicit package dispatch. Every other branch remains in the graph.
function specialize(node, packageId) {
  const transform = ts.transform(node, [(context) => {
    const visit = (child) => {
      if (ts.isElementAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword) {
        throw new Error("Dynamic method dispatch cannot be scoped")
      }
      if (ts.isSwitchStatement(child) && child.expression.getText() === "packageId") {
        if (child.caseBlock.clauses.some((clause) => clause.statements.length === 0)) {
          return ts.visitEachChild(child, visit, context)
        }
        const clauses = child.caseBlock.clauses.filter((clause) =>
          ts.isDefaultClause(clause) || !ts.isStringLiteral(clause.expression) || clause.expression.text === packageId)
        return ts.factory.updateSwitchStatement(child, child.expression,
          ts.factory.updateCaseBlock(child.caseBlock, clauses.map((clause) => ts.visitEachChild(clause, visit, context))))
      }
      if (ts.isIfStatement(child) && ts.isBinaryExpression(child.expression)
        && child.expression.left.getText() === "packageId"
        && child.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        && ts.isStringLiteral(child.expression.right)) {
        return ts.visitNode(child.expression.right.text === packageId
          ? child.thenStatement : child.elseStatement ?? ts.factory.createEmptyStatement(), visit)
      }
      return ts.visitEachChild(child, visit, context)
    }
    return (root) => ts.visitNode(root, visit)
  }])
  const result = transform.transformed[0]
  transform.dispose()
  return result
}

export function packageFingerprint(read, packageId, registryIds = [packageId], changedSourcePaths = []) {
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const text = read(path)
    if (text === undefined) throw new Error(`Missing dependency: ${path}`)
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${path}`)
    parts.push(`${path}:imports\n${source.statements.filter(ts.isImportDeclaration).map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n")}`)
    const units = new Map()
    const imports = new Map()
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier.text
        if (!specifier.startsWith(".")) continue
        const target = posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, ".ts")
        const bindings = statement.importClause?.namedBindings
        if (!statement.importClause) throw new Error(`Side-effect import in ${path}`)
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) imports.set(binding.name.text, [target, binding.propertyName?.text ?? binding.name.text])
        } else if (bindings || statement.importClause?.name) {
          throw new Error(`Unsupported local import in ${path}`)
        }
      } else if (ts.isClassDeclaration(statement)) {
        parts.push(`${path}:class-header:${statement.name?.text}:${statement.heritageClauses?.map((clause) => printer.printNode(ts.EmitHint.Unspecified, clause, source)).join(" ")}:${statement.modifiers?.map((modifier) => printer.printNode(ts.EmitHint.Unspecified, modifier, source)).join(" ")}`)
        for (const member of statement.members) {
          if (member.name && ts.isIdentifier(member.name)) units.set(member.name.text, member)
          else if (ts.isConstructorDeclaration(member)) units.set("constructor", member)
          else throw new Error(`Unsupported class member in ${path}`)
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) throw new Error(`Unsupported binding in ${path}`)
          units.set(declaration.name.text, declaration)
        }
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        units.set(statement.name.text, statement)
      } else if (statement.kind !== ts.SyntaxKind.EndOfFileToken) {
        throw new Error(`Unsupported top-level statement in ${path}`)
      }
    }
    const module = { source, units, imports }
    modules.set(path, module)
    return module
  }
  const seen = new Set()
  const parts = []
  function collect(path, name) {
    const key = `${path}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    const module = load(path)
    if (module.imports.has(name)) {
      collect(...module.imports.get(name))
      return
    }
    let node = module.units.get(name)
    if (!node) return
    if (name === "plans" && ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      node = ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
        ts.factory.updateObjectLiteralExpression(node.initializer, node.initializer.properties.filter((property) =>
          property.name && (ts.isStringLiteral(property.name) ? property.name.text : property.name.getText()) === packageId)))
    }
    if (name === "PACKAGE_REGISTRY" && ts.isVariableDeclaration(node) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      const entries = node.initializer.elements.filter((entry) => {
        if (!ts.isObjectLiteralExpression(entry)) throw new Error("Unsupported registry entry")
        const id = entry.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText() === "id")
        if (!id || !ts.isStringLiteral(id.initializer)) throw new Error("Unsupported registry id")
        return registryIds.includes(id.initializer.text)
      })
      node = ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
        ts.factory.updateArrayLiteralExpression(node.initializer, entries))
    }
    node = specialize(node, packageId)
    parts.push(`${key}\n${printer.printNode(ts.EmitHint.Unspecified, node, module.source)}`)
    const walk = (child) => {
      if (ts.isIdentifier(child)) {
        const dependency = child.text
        if (module.units.has(dependency) || module.imports.has(dependency)) collect(path, dependency)
      }
      ts.forEachChild(child, walk)
    }
    walk(node)
  }
  for (const path of changedSourcePaths) load(path)
  for (const [name, node] of load(pipeline).units) {
    if (ts.isPropertyDeclaration(node)) collect(pipeline, name)
  }
  for (const root of ["constructor", "ciCheck", "artifactCheck"]) collect(pipeline, root)
  load(pipeline)
  for (const [path, module] of modules) {
    for (const [name, node] of module.units) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        let eagerCall = false
        const scan = (child) => {
          if (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return
          if (ts.isCallExpression(child) || ts.isNewExpression(child)) eagerCall = true
          ts.forEachChild(child, scan)
        }
        scan(node.initializer)
        if (eagerCall) collect(path, name)
      }
    }
  }
  if (!seen.has(`${pipeline}:ciCheck`) || !load(pipeline).units.has("ciCheck")) throw new Error("Missing CI root")
  return parts.sort().join("\n")
}

// Job-level boundaries are deliberately narrow. Execution/runtime changes stay fail-safe.
export function regressionOnlyWorkflowChange(before, after) {
  if (before === undefined || after === undefined) return false
  const normalize = (text) => text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim()).join("\n")
  const omitTests = (text) => text.replace(/\n  (?:tap-pipeline-tests|plan):\n[\s\S]*?(?=\n  [\w-]+:\n)/g, "")
  return normalize(omitTests(before)) === normalize(omitTests(after))
}

export function nonsemanticScriptChange(path, before, after) {
  if (before === undefined || after === undefined || !/\.(?:mjs|js|ts)$/.test(path)) return false
  const render = (text) => {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
      path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS)
    if (source.parseDiagnostics.length) return undefined
    return printer.printFile(source)
  }
  const old = render(before)
  return old !== undefined && old === render(after)
}
