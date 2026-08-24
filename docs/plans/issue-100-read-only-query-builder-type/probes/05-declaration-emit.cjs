/**
 * PROBE 05 — proves §3.3 V8: declaration emit is clean and self-contained.
 *
 * WHY THIS IS SEPARATE FROM A TYPE-CHECK. A new public type can type-check perfectly and still
 * poison the published `.d.ts`. The specific hazard in this repo: `@google-cloud/firestore` is a
 * transitive of the `firebase-admin` peer and appears in neither `dependencies` nor
 * `peerDependencies`, so referencing one of its types resolves fine under npm hoisting, emits into
 * `dist/**.d.ts`, and then breaks a strict-pnpm consumer. `npm run test:types` cannot see that;
 * declaration emit can. `ExplainOptions` / `ExplainMetrics` in QueryBuilder.ts exist precisely
 * because firebase-admin's public allowlist does not re-export them (ADR-0031), so this is a live
 * concern on this file, not a theoretical one.
 *
 * The second thing it proves: `ReadOnlyQueryClauseKeys` is NOT exported, yet the exported interface's
 * `extends` clause references it. TypeScript emits it as a local alias in the same `.d.ts`, which is
 * legal and self-contained — but it is also why the helper must never be tagged `@internal`
 * (`tsconfig.json` sets `stripInternal: true`, which would strip the declaration and leave the
 * reference dangling). That is trap T5.
 *
 * Run: node docs/plans/issue-100-read-only-query-builder-type/probes/05-declaration-emit.cjs
 *      (from the repo root)
 *
 * EXPECTED: 0 emit diagnostics; the emitted .d.ts imports ONLY ./core/QueryBuilder.js,
 * ./core/DocumentId.js and ./utils/pathTypes.js; no `@google-cloud/firestore` and no bare
 * `firebase-admin` specifier anywhere in it. Exit code 0 only when all of that holds.
 *
 * Note this compiles §6.1 ALONE (not probe 03), because probe 03's assertion half pulls in `zod` and
 * the repository — irrelevant to what the shipped declaration looks like.
 */
const path = require('path');
const { compileProbe } = require('./harness.cjs');

// §6.1 verbatim, minus the JSDoc (which does not affect emit) and with the `export` kept, since an
// unexported interface would not be emitted at all and the probe would prove nothing.
const SOURCE = `import type { FirestoreDocument } from './core/DocumentId.js';
import type { DeepPartial } from './utils/pathTypes.js';
import { FirestoreQueryBuilder } from './core/QueryBuilder.js';

type ReadOnlyQueryClauseKeys =
  | 'where'
  | 'whereFilter'
  | 'whereId'
  | 'orderBy'
  | 'orderById'
  | 'limit'
  | 'limitToLast'
  | 'offset'
  | 'startAt'
  | 'startAfter'
  | 'endAt'
  | 'endBefore'
  | 'select';

export interface ReadOnlyQuery<
  T extends object,
  W extends object = T,
  S extends object = T,
  R = FirestoreDocument<T>,
> extends Omit<FirestoreQueryBuilder<T, W, S, R>, 'update' | 'delete' | ReadOnlyQueryClauseKeys> {
  where(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['where']>): ReadOnlyQuery<T, W, S, R>;
  whereFilter(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['whereFilter']>
  ): ReadOnlyQuery<T, W, S, R>;
  whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): ReadOnlyQuery<T, W, S, R>;
  whereId(op: 'in' | 'not-in', value: readonly string[]): ReadOnlyQuery<T, W, S, R>;
  orderBy(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderBy']>): ReadOnlyQuery<T, W, S, R>;
  orderById(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderById']>
  ): ReadOnlyQuery<T, W, S, R>;
  limit(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['limit']>): ReadOnlyQuery<T, W, S, R>;
  limitToLast(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['limitToLast']>
  ): ReadOnlyQuery<T, W, S, R>;
  offset(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['offset']>): ReadOnlyQuery<T, W, S, R>;
  startAt(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['startAt']>): ReadOnlyQuery<T, W, S, R>;
  startAfter(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['startAfter']>
  ): ReadOnlyQuery<T, W, S, R>;
  endAt(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['endAt']>): ReadOnlyQuery<T, W, S, R>;
  endBefore(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['endBefore']>
  ): ReadOnlyQuery<T, W, S, R>;
  select(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['select']>
  ): ReadOnlyQuery<T, W, S, FirestoreDocument<DeepPartial<T>>>;
}
`;

const { diagnostics, emitted } = compileProbe(SOURCE, {
  compilerOptions: {
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    outDir: undefined,
    declarationDir: undefined,
  },
  emit: true,
});

const dtsName = Object.keys(emitted).find(f => f.includes('__probe_ff__.d.ts'));
const dts = dtsName ? emitted[dtsName] : '';

console.log(`=== EMIT DIAGNOSTICS (${diagnostics.length}) ===`);
for (const d of diagnostics) console.log(`  ${d}`);
console.log(`=== ${dtsName ? path.basename(dtsName) : '(nothing emitted)'} ===`);
console.log(dts);

const UNDECLARED = ['@google-cloud/firestore', 'firebase-admin'];
const leaked = UNDECLARED.filter(pkg => dts.includes(pkg));
const checks = [
  ['0 emit diagnostics', diagnostics.length === 0],
  ['a .d.ts was emitted', dts.length > 0],
  ['exports ReadOnlyQuery', /export interface ReadOnlyQuery</.test(dts)],
  [
    'ReadOnlyQueryClauseKeys emitted locally (so it must NOT be tagged @internal — trap T5)',
    /type ReadOnlyQueryClauseKeys =/.test(dts),
  ],
  [`no undeclared package specifier (${UNDECLARED.join(', ')})`, leaked.length === 0],
];

console.log('=== CHECKS ===');
let failures = 0;
for (const [label, ok] of checks) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}
if (leaked.length) console.log(`  leaked: ${leaked.join(', ')}`);
process.exit(failures === 0 ? 0 : 1);
