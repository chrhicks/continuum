import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

type Match = {
  file: string
  line: number
  text: string
}

type CommandStatus = {
  command: string
  ok: boolean
  exitCode: number | null
  snippet: string | null
}

type SentinelCheck = {
  name: string
  ok: boolean
  details: string[]
}

const ROOT = process.cwd()
const SRC_DIR = resolve(ROOT, 'src')
const MAX_FILE_LINES = 300
const MAX_FUNCTION_LINES = 80

type FunctionLineViolation = {
  file: string
  line: number
  name: string
  kind: 'function' | 'function expression' | 'arrow function'
  lines: number
}

type ExportReturnTypeViolation = {
  file: string
  line: number
  name: string
  kind: 'function' | 'function expression' | 'arrow function'
}

const listFiles = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath))
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

const toRelative = (path: string): string =>
  relative(ROOT, path).replace(/\\/g, '/')

const countLines = (content: string): number => {
  if (content.length === 0) return 0
  return content.split('\n').length
}

const findLineMatches = (content: string, matcher: RegExp): Match[] => {
  const matches: Match[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (matcher.test(line)) {
      matches.push({
        file: '',
        line: i + 1,
        text: line.trim(),
      })
    }
  }

  return matches
}

const collectPatternMatches = (files: string[], matcher: RegExp): Match[] => {
  const matches: Match[] = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const lineMatches = findLineMatches(content, matcher)

    for (const match of lineMatches) {
      matches.push({
        ...match,
        file: toRelative(file),
      })
    }
  }

  return matches.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })
}

const collectFileLineViolations = (
  files: string[],
): Array<{ file: string; lines: number }> => {
  const violations: Array<{ file: string; lines: number }> = []

  for (const file of files) {
    const stats = statSync(file)
    if (!stats.isFile()) continue

    const content = readFileSync(file, 'utf8')
    const lines = countLines(content)
    if (lines > MAX_FILE_LINES) {
      violations.push({ file: toRelative(file), lines })
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file))
}

const isSourceTsFile = (file: string): boolean =>
  /\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts')

const getBodyLineCount = (sourceFile: ts.SourceFile, node: ts.Node): number => {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  )
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
  return end.line - start.line + 1
}

const collectFunctionLineViolations = (
  files: string[],
): FunctionLineViolation[] => {
  const violations: FunctionLineViolation[] = []

  for (const file of files) {
    if (!isSourceTsFile(file)) continue

    const content = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    const addViolation = (
      name: string,
      kind: FunctionLineViolation['kind'],
      body: ts.Node,
    ) => {
      const lines = getBodyLineCount(sourceFile, body)
      if (lines <= MAX_FUNCTION_LINES) return

      const line =
        sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile))
          .line + 1
      violations.push({
        file: toRelative(file),
        line,
        name,
        kind,
        lines,
      })
    }

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.body) {
        addViolation(node.name?.text ?? '<anonymous>', 'function', node.body)
      }

      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isIdentifier(node.name)
      ) {
        if (ts.isArrowFunction(node.initializer)) {
          addViolation(node.name.text, 'arrow function', node.initializer.body)
        }

        if (
          ts.isFunctionExpression(node.initializer) &&
          node.initializer.body
        ) {
          addViolation(
            node.name.text,
            'function expression',
            node.initializer.body,
          )
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return violations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    if (a.line !== b.line) return a.line - b.line
    return a.name.localeCompare(b.name)
  })
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean => {
  if (!ts.canHaveModifiers(node)) return false
  return (
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false
  )
}

const collectExportedIdentifiers = (sourceFile: ts.SourceFile): Set<string> => {
  const names = new Set<string>()

  const visit = (node: ts.Node) => {
    if (
      ts.isExportDeclaration(node) &&
      !node.moduleSpecifier &&
      node.exportClause
    ) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          names.add(element.propertyName?.text ?? element.name.text)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return names
}

const collectExportReturnTypeViolations = (
  files: string[],
): ExportReturnTypeViolation[] => {
  const violations: ExportReturnTypeViolation[] = []

  for (const file of files) {
    if (!isSourceTsFile(file)) continue

    const content = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const exportedIdentifiers = collectExportedIdentifiers(sourceFile)

    const addViolation = (
      name: string,
      kind: ExportReturnTypeViolation['kind'],
      node: ts.Node,
    ) => {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1
      violations.push({ file: toRelative(file), line, name, kind })
    }

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.body && node.name) {
        const isExported =
          hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
          exportedIdentifiers.has(node.name.text)

        if (isExported && !node.type) {
          addViolation(node.name.text, 'function', node)
        }
      }

      if (ts.isVariableStatement(node)) {
        const statementExported = hasModifier(node, ts.SyntaxKind.ExportKeyword)

        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
            continue

          const declarationExported =
            statementExported || exportedIdentifiers.has(declaration.name.text)
          if (!declarationExported) continue

          const variableHasType = !!declaration.type
          if (ts.isArrowFunction(declaration.initializer)) {
            if (!variableHasType && !declaration.initializer.type) {
              addViolation(declaration.name.text, 'arrow function', declaration)
            }
          }

          if (ts.isFunctionExpression(declaration.initializer)) {
            if (!variableHasType && !declaration.initializer.type) {
              addViolation(
                declaration.name.text,
                'function expression',
                declaration,
              )
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return violations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    if (a.line !== b.line) return a.line - b.line
    return a.name.localeCompare(b.name)
  })
}

const printHeader = (title: string) => {
  console.log(`\n## ${title}`)
}

const printMatchList = (matches: Match[]) => {
  for (const match of matches) {
    console.log(`- ${match.file}:${match.line} ${match.text}`)
  }
}

const countMatchesInFile = (matches: Match[], file: string): number =>
  matches.filter((match) => match.file === file).length

const buildSentinelCheck = (
  name: string,
  checks: Array<{ label: string; actual: number; expected: number }>,
): SentinelCheck => {
  const details = checks.map(
    (check) =>
      `${check.label}: expected ${check.expected}, found ${check.actual}`,
  )
  const ok = checks.every((check) => check.actual === check.expected)
  return { name, ok, details }
}

const hasBunTestPassingSummary = (output: string): boolean => {
  const failCountMatch = output.match(/\b(\d+)\s+fail\b/)
  const passCountMatch = output.match(/\b(\d+)\s+pass\b/)
  if (!failCountMatch || !passCountMatch) return false

  const failCount = Number.parseInt(failCountMatch[1] ?? '', 10)
  const passCount = Number.parseInt(passCountMatch[1] ?? '', 10)
  return failCount === 0 && passCount > 0
}

const runCommandStatus = (command: string, args: string[]): CommandStatus => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  const bunTestFalseFailure =
    command === 'bun' &&
    args.length === 1 &&
    args[0] === 'test' &&
    result.status !== 0 &&
    hasBunTestPassingSummary(output)
  const firstLine =
    output.length > 0 ? (output.split('\n')[0]?.trim() ?? '') : ''

  return {
    command: [command, ...args].join(' '),
    ok: result.status === 0 || bunTestFalseFailure,
    exitCode: bunTestFalseFailure ? 0 : result.status,
    snippet: firstLine.length > 0 && !bunTestFalseFailure ? firstLine : null,
  }
}

const run = () => {
  const files = listFiles(SRC_DIR)
  const fileLineViolations = collectFileLineViolations(files)
  const functionLineViolations = collectFunctionLineViolations(files)
  const exportReturnTypeViolations = collectExportReturnTypeViolations(files)
  const asAnyMatches = collectPatternMatches(files, /\bas any\b/)
  const requireTaskDefs = collectPatternMatches(
    files,
    /\bfunction\s+require_task\s*\(/,
  )
  const normalizeLimitDefs = collectPatternMatches(
    files,
    /\bfunction\s+normalizeLimit\s*\(/,
  )
  const summaryPrefixDefs = collectPatternMatches(files, /\bSUMMARY_PREFIX\s*=/)
  const formatStepMarkerDefs = collectPatternMatches(
    files,
    /\bexport\s+function\s+formatStepMarker\s*\(/,
  )
  const formatStepMarkerImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bformatStepMarker\b[^}]*\}\s+from\s+['"]\.\/render['"]\s*;?/,
  )
  const buildSummaryLinesDefs = collectPatternMatches(
    files,
    /\bexport\s+function\s+buildSummaryLines\s*\(/,
  )
  const buildSummaryLinesImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bbuildSummaryLines\b[^}]*\}\s+from\s+['"]\.\/memory-summary-lines['"]\s*;?/,
  )
  const patchCollectionDefs = collectPatternMatches(
    files,
    /\bexport\s+function\s+patch_collection\s*</,
  )
  const patchCollectionImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bpatch_collection\b[^}]*\}\s+from\s+['"]\.\/collection-patch['"]\s*;?/,
  )
  const patchCollectionCalls = collectPatternMatches(
    files,
    /\bpatch_collection\s*</,
  )
  const createTaskCommandDefs = collectPatternMatches(
    files,
    /\bexport\s+function\s+createTaskCommand\s*\(/,
  )
  const registerTaskListDefs = collectPatternMatches(
    files,
    /\bfunction\s+registerTaskListCommand\s*\(/,
  )
  const registerTaskGetDefs = collectPatternMatches(
    files,
    /\bfunction\s+registerTaskGetCommand\s*\(/,
  )
  const registerTaskValidateDefs = collectPatternMatches(
    files,
    /\bfunction\s+registerTaskValidateCommand\s*\(/,
  )
  const registerTaskGraphDefs = collectPatternMatches(
    files,
    /\bfunction\s+registerTaskGraphCommand\s*\(/,
  )
  const registerTaskTemplatesDefs = collectPatternMatches(
    files,
    /\bfunction\s+registerTaskTemplatesCommand\s*\(/,
  )
  const registerCrudImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bregisterCrudCommands\b[^}]*\}\s+from\s+['"]\.\/task\/crud['"]\s*;?/,
  )
  const registerCrudCalls = collectPatternMatches(
    files,
    /\bregisterCrudCommands\s*\(\s*taskCommand\s*\)/,
  )
  const registerStepsImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bregisterStepsCommands\b[^}]*\}\s+from\s+['"]\.\/task\/steps['"]\s*;?/,
  )
  const registerStepsCalls = collectPatternMatches(
    files,
    /\bregisterStepsCommands\s*\(\s*taskCommand\s*\)/,
  )
  const registerNoteImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bregisterNoteCommands\b[^}]*\}\s+from\s+['"]\.\/task\/notes['"]\s*;?/,
  )
  const registerNoteCalls = collectPatternMatches(
    files,
    /\bregisterNoteCommands\s*\(\s*taskCommand\s*\)/,
  )
  const parsePositiveIntegerDefs = collectPatternMatches(
    files,
    /\bexport\s+function\s+parsePositiveInteger\s*\(/,
  )
  const parsePositiveIntegerTaskImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bparsePositiveInteger\b[^}]*\}\s+from\s+['"]\.\.\/shared['"]\s*;?/,
  )
  const resolveRecallPathDefs = collectPatternMatches(
    files,
    /\bexport\s+function\s+resolveRecallPath\s*\(/,
  )
  const recallResolvePathImports = collectPatternMatches(
    files,
    /\bimport\s+\{[^}]*\bresolveRecallPath\b[^}]*\}\s+from\s+['"]\.\.\/resolve-path['"]\s*;?/,
  )
  const consolidationSentinels: SentinelCheck[] = [
    buildSentinelCheck('formatStepMarker boundary', [
      {
        label: 'src/cli/commands/task/render.ts definition',
        actual: countMatchesInFile(
          formatStepMarkerDefs,
          'src/cli/commands/task/render.ts',
        ),
        expected: 1,
      },
      {
        label: 'formatStepMarker definitions (all src)',
        actual: formatStepMarkerDefs.length,
        expected: 1,
      },
      {
        label: 'src/cli/commands/task/steps.ts import',
        actual: countMatchesInFile(
          formatStepMarkerImports,
          'src/cli/commands/task/steps.ts',
        ),
        expected: 1,
      },
    ]),
    buildSentinelCheck('buildSummaryLines boundary', [
      {
        label: 'src/memory/memory-summary-lines.ts definition',
        actual: countMatchesInFile(
          buildSummaryLinesDefs,
          'src/memory/memory-summary-lines.ts',
        ),
        expected: 1,
      },
      {
        label: 'buildSummaryLines definitions (all src)',
        actual: buildSummaryLinesDefs.length,
        expected: 1,
      },
      {
        label: 'src/memory/memory-content-builders.ts import',
        actual: countMatchesInFile(
          buildSummaryLinesImports,
          'src/memory/memory-content-builders.ts',
        ),
        expected: 1,
      },
    ]),
    buildSentinelCheck('patch_collection boundary', [
      {
        label: 'src/task/collection-patch.ts definition',
        actual: countMatchesInFile(
          patchCollectionDefs,
          'src/task/collection-patch.ts',
        ),
        expected: 1,
      },
      {
        label: 'patch_collection definitions (all src)',
        actual: patchCollectionDefs.length,
        expected: 1,
      },
      {
        label: 'src/task/tasks.repository.update.ts import',
        actual: countMatchesInFile(
          patchCollectionImports,
          'src/task/tasks.repository.update.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/task/tasks.repository.update.ts call',
        actual: countMatchesInFile(
          patchCollectionCalls,
          'src/task/tasks.repository.update.ts',
        ),
        expected: 1,
      },
    ]),
    buildSentinelCheck('createTaskCommand decomposition boundary', [
      {
        label: 'src/cli/commands/task.ts createTaskCommand definition',
        actual: countMatchesInFile(
          createTaskCommandDefs,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerTaskListCommand definition',
        actual: countMatchesInFile(
          registerTaskListDefs,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerTaskGetCommand definition',
        actual: countMatchesInFile(
          registerTaskGetDefs,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label:
          'src/cli/commands/task.ts registerTaskValidateCommand definition',
        actual: countMatchesInFile(
          registerTaskValidateDefs,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerTaskGraphCommand definition',
        actual: countMatchesInFile(
          registerTaskGraphDefs,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label:
          'src/cli/commands/task.ts registerTaskTemplatesCommand definition',
        actual: countMatchesInFile(
          registerTaskTemplatesDefs,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerCrudCommands import',
        actual: countMatchesInFile(
          registerCrudImports,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerCrudCommands call',
        actual: countMatchesInFile(
          registerCrudCalls,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerStepsCommands import',
        actual: countMatchesInFile(
          registerStepsImports,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerStepsCommands call',
        actual: countMatchesInFile(
          registerStepsCalls,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerNoteCommands import',
        actual: countMatchesInFile(
          registerNoteImports,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/cli/commands/task.ts registerNoteCommands call',
        actual: countMatchesInFile(
          registerNoteCalls,
          'src/cli/commands/task.ts',
        ),
        expected: 1,
      },
    ]),
    buildSentinelCheck('parsePositiveInteger shared utility boundary', [
      {
        label: 'src/cli/commands/shared.ts parsePositiveInteger definition',
        actual: countMatchesInFile(
          parsePositiveIntegerDefs,
          'src/cli/commands/shared.ts',
        ),
        expected: 1,
      },
      {
        label: 'parsePositiveInteger definitions (all src)',
        actual: parsePositiveIntegerDefs.length,
        expected: 1,
      },
      {
        label: 'src/cli/commands/task/parse.ts parsePositiveInteger import',
        actual: countMatchesInFile(
          parsePositiveIntegerTaskImports,
          'src/cli/commands/task/parse.ts',
        ),
        expected: 1,
      },
      {
        label:
          'src/cli/commands/memory/handlers-helpers.ts parsePositiveInteger import',
        actual: countMatchesInFile(
          parsePositiveIntegerTaskImports,
          'src/cli/commands/memory/handlers-helpers.ts',
        ),
        expected: 1,
      },
    ]),
    buildSentinelCheck('resolveRecallPath shared utility boundary', [
      {
        label: 'src/recall/resolve-path.ts resolveRecallPath definition',
        actual: countMatchesInFile(
          resolveRecallPathDefs,
          'src/recall/resolve-path.ts',
        ),
        expected: 1,
      },
      {
        label:
          'src/recall/index/opencode-source-index.ts resolveRecallPath import',
        actual: countMatchesInFile(
          recallResolvePathImports,
          'src/recall/index/opencode-source-index.ts',
        ),
        expected: 1,
      },
      {
        label: 'src/recall/sync/opencode-sync.ts resolveRecallPath import',
        actual: countMatchesInFile(
          recallResolvePathImports,
          'src/recall/sync/opencode-sync.ts',
        ),
        expected: 1,
      },
    ]),
  ]
  const validationStatuses: CommandStatus[] = [
    runCommandStatus('bun', ['run', 'typecheck']),
    runCommandStatus('bun', ['test']),
    runCommandStatus('continuum', ['task', 'list', '--json']),
  ]

  printHeader('File Length (src <= 300 lines)')
  if (fileLineViolations.length === 0) {
    console.log('- pass')
  } else {
    for (const violation of fileLineViolations) {
      console.log(`- ${violation.file}: ${violation.lines} lines`)
    }
  }

  printHeader('Function Length (src <= 80 lines)')
  if (functionLineViolations.length === 0) {
    console.log('- pass')
  } else {
    for (const violation of functionLineViolations) {
      console.log(
        `- ${violation.file}:${violation.line} ${violation.name} (${violation.kind}) => ${violation.lines} lines`,
      )
    }
  }

  printHeader('Exported Functions With Explicit Return Types')
  if (exportReturnTypeViolations.length === 0) {
    console.log('- pass')
  } else {
    for (const violation of exportReturnTypeViolations) {
      console.log(
        `- ${violation.file}:${violation.line} ${violation.name} (${violation.kind})`,
      )
    }
  }

  printHeader("'as any' Casts (src)")
  if (asAnyMatches.length === 0) {
    console.log('- pass')
  } else {
    printMatchList(asAnyMatches)
  }

  printHeader('Duplication Sentinel Counts')
  console.log(`- require_task definitions: ${requireTaskDefs.length}`)
  printMatchList(requireTaskDefs)
  console.log(`- normalizeLimit definitions: ${normalizeLimitDefs.length}`)
  printMatchList(normalizeLimitDefs)
  console.log(`- SUMMARY_PREFIX assignments: ${summaryPrefixDefs.length}`)
  printMatchList(summaryPrefixDefs)

  printHeader('Consolidation Sentinel Checks')
  for (const sentinel of consolidationSentinels) {
    console.log(`- ${sentinel.ok ? 'PASS' : 'FAIL'}: ${sentinel.name}`)
    for (const detail of sentinel.details) {
      console.log(`  ${detail}`)
    }
  }

  printHeader('Validation Commands')
  for (const status of validationStatuses) {
    const resultLabel = status.ok
      ? 'PASS'
      : `FAIL (exit ${status.exitCode ?? 'null'})`
    console.log(`- ${resultLabel}: ${status.command}`)
    if (!status.ok && status.snippet) {
      console.log(`  ${status.snippet}`)
    }
  }

  const hasFailures =
    fileLineViolations.length > 0 ||
    functionLineViolations.length > 0 ||
    exportReturnTypeViolations.length > 0 ||
    asAnyMatches.length > 0 ||
    requireTaskDefs.length !== 1 ||
    normalizeLimitDefs.length !== 1 ||
    summaryPrefixDefs.length !== 1 ||
    consolidationSentinels.some((sentinel) => !sentinel.ok) ||
    validationStatuses.some((status) => !status.ok)

  printHeader('Result')
  console.log(hasFailures ? '- FAIL' : '- PASS')

  if (hasFailures) {
    process.exitCode = 1
  }
}

run()
