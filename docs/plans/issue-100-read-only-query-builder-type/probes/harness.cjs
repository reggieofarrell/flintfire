/**
 * Probe harness for issue #100 (ReadOnlyQuery).
 *
 * WHY A VIRTUAL FILE. A probe must resolve types through the REAL module graph
 * (`firebase-admin/firestore`, `zod`, `src/core/*`) under the REAL compiler options, or its answers
 * are about a different program than the one the gate checks. But it must not leave a file in
 * `src/` — that would put deliberate type errors inside `tsconfig`'s `include`. So the probe source
 * is mounted at `src/__probe_ff__.ts` in-memory, on top of a normal compiler host built from
 * `tsconfig.typecheck.json`. Nothing is written to disk and nothing is emitted.
 *
 * WHY typeToString AND NOT ERROR TEXT. A type claim read off a diagnostic message is a claim about
 * how TypeScript *phrases* a failure. `checker.typeToString` on the resolved type is a claim about
 * the type. The naming convention below is what selects which question gets asked:
 *
 *   type P_foo = <type>          resolve and print it; union constituents are sorted so the output
 *                               is diff-stable across TypeScript versions
 *   type M_foo = <type>          list getPropertiesOfType (INCLUDES protected/private — use P_ with
 *                               `keyof` when you want the public surface, which is what a
 *                               structural read-only view actually sees)
 *   declare const p_foo: T       print the resolved type of the binding
 *   const p_foo = expr           print the inferred type of the expression (this is how a fluent
 *                               chain's result type is captured)
 *
 * Diagnostics are printed for the probe file only. `@ts-expect-error` inverts the meaning of a
 * clean run: **0 diagnostics means every expectation was satisfied**, i.e. each annotated line
 * really was an error. A TS2578 ("unused '@ts-expect-error' directive") is the signal that a guard
 * stopped guarding.
 *
 * USAGE — from the repo root (cwd matters: the virtual file is mounted relative to it):
 *
 *   node docs/plans/issue-100-read-only-query-builder-type/probes/harness.cjs \
 *        docs/plans/issue-100-read-only-query-builder-type/probes/01-member-sets.ts
 *
 * Probes 04 and 05 `require()` this file instead and use `compileProbe(source, overrides)` — same
 * program setup, so a mutation or a declaration-emit run cannot silently differ from the plain
 * type-check it is being compared against.
 *
 * `docs/plans/**` is outside `tsconfig` `include`, inside `eslint.config.js` `ignores`, and inside
 * `.prettierignore`, so none of this can affect a gate. See `docs/plans/README.md`.
 */
const ts = require('typescript');
const path = require('path');
const fs = require('fs');

const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;

/** Fails loudly rather than silently type-checking a different program than the gate does. */
function repoRoot() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'tsconfig.typecheck.json'))) {
    console.error(`error: no tsconfig.typecheck.json in ${root} — run this from the repo root.`);
    process.exit(2);
  }
  return root;
}

/**
 * Type-checks `source` as a virtual `src/__probe_ff__.ts` under tsconfig.typecheck.json's options.
 *
 * @param {string} source                    probe source text
 * @param {{ compilerOptions?: object, emit?: boolean }} [options]
 *   `compilerOptions` merges over the parsed config (probe 05 turns declaration emit on).
 *   `emit` runs `program.emit()` and captures output in memory — nothing reaches disk.
 * @returns {{ diagnostics: string[], resolved: string[], emitted: Record<string, string> }}
 */
function compileProbe(source, options = {}) {
  const root = repoRoot();
  const virtualPath = path.join(root, 'src', '__probe_ff__.ts');

  const configFile = ts.readConfigFile(path.join(root, 'tsconfig.typecheck.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const compilerOptions = { ...parsed.options, ...(options.compilerOptions ?? {}) };

  const host = ts.createCompilerHost(compilerOptions, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === virtualPath
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : readSourceFile(fileName, languageVersion, onError, shouldCreate);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = fileName => (fileName === virtualPath ? true : fileExists(fileName));
  const readFile = host.readFile.bind(host);
  host.readFile = fileName => (fileName === virtualPath ? source : readFile(fileName));

  const emitted = {};
  host.writeFile = (fileName, data) => {
    emitted[fileName] = data;
  };

  const program = ts.createProgram([virtualPath], compilerOptions, host);
  const checker = program.getTypeChecker();
  const probeFile = program.getSourceFile(virtualPath);

  let raw = ts.getPreEmitDiagnostics(program, probeFile);
  if (options.emit) raw = raw.concat(program.emit().diagnostics);

  const diagnostics = raw.map(d => {
    const line =
      d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : -1;
    return `TS${d.code} @L${line}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });

  const resolved = [];
  for (const statement of probeFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      const name = statement.name.text;
      if (name.startsWith('P_')) {
        const type = checker.getTypeFromTypeNode(statement.type);
        const text = type.isUnion()
          ? type.types
              .map(t => checker.typeToString(t, undefined, FORMAT))
              .sort()
              .join(' | ')
          : checker.typeToString(type, undefined, FORMAT);
        resolved.push(`${name} := ${text}`);
      } else if (name.startsWith('M_')) {
        const props = checker
          .getPropertiesOfType(checker.getTypeFromTypeNode(statement.type))
          .map(p => p.getName())
          .sort();
        resolved.push(`${name} props (${props.length}): ${props.join(', ')}`);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text.startsWith('p_')) {
          const type = checker.getTypeAtLocation(decl.name);
          resolved.push(`${decl.name.text} : ${checker.typeToString(type, undefined, FORMAT)}`);
        }
      }
    }
  }

  return { diagnostics, resolved, emitted };
}

module.exports = { compileProbe, repoRoot, ts };

if (require.main === module) {
  const probePath = process.argv[2];
  if (!probePath) {
    console.error('usage: node probes/harness.cjs <probe.ts>   (run from the repo root)');
    process.exit(2);
  }
  const { diagnostics, resolved } = compileProbe(fs.readFileSync(probePath, 'utf8'));
  console.log(`### probe: ${path.basename(probePath)}   (TypeScript ${ts.version})`);
  console.log(`=== DIAGNOSTICS (${diagnostics.length}) ===`);
  for (const d of diagnostics) console.log(`  ${d}`);
  console.log('=== RESOLVED ===');
  for (const line of resolved) console.log(`  ${line}`);
}
