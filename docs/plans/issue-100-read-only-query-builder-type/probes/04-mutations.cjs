/**
 * PROBE 04 — proves §3.4 (M1, M1', M2, M3): that the §8.1 guards actually FIRE.
 *
 * A guard that passes both with and without the defect guards nothing. This probe mutates probe 03's
 * source in memory — four ways, each modelling a specific realistic mistake — and reports whether
 * `tsc` complains. It is the evidence behind traps T2, T3 and T4.
 *
 * The headline finding is M1 vs M1': ADR-0041 decision 4 and issue #100 both present the drift
 * guard as `type Missing = Exclude<…>; // must be never`. That form is **inert** — it resolves to
 * the wrong type and emits nothing. Only the asserted form fails the gate.
 *
 * Run: node docs/plans/issue-100-read-only-query-builder-type/probes/04-mutations.cjs
 *      (from the repo root)
 *
 * EXPECTED:
 *   M0  baseline, unmutated               0 diagnostics
 *   M1  member dropped, BARE guard        0 diagnostics  ← the guard is inert; Missing := "orderById"
 *   M1' member dropped, ASSERTED guard    TS2344         ← this is the form to ship
 *   M2  clause returns the full builder   TS2344 on the NoWrites row; key guards stay `never`
 *   M3  clause key misspelled in the Omit TS2430 at the `extends` clause
 *
 * Exit code 0 only when all five expectations hold, so this doubles as a self-check.
 */
const fs = require('fs');
const path = require('path');
const { compileProbe } = require('./harness.cjs');

const BASE = fs.readFileSync(path.join(__dirname, '03-readonly-query.ts'), 'utf8');

/** Fails loudly instead of silently mutating nothing — a no-op replace would fake a passing probe. */
function replaceOnce(source, find, replaceWith, label) {
  const parts = source.split(find);
  if (parts.length !== 2) {
    throw new Error(
      `mutation "${label}": expected exactly 1 occurrence of the anchor, found ${parts.length - 1}. ` +
        `03-readonly-query.ts has drifted — re-anchor this mutation.`,
    );
  }
  return parts.join(replaceWith);
}

const ORDER_BY_ID_MEMBER = `  orderById(
    ...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['orderById']>
  ): ReadOnlyQuery<T, W, S, R>;
`;
const ORDER_BY_ID_ROW = `type _c05 = AssertTrue<NoWrites<ReturnType<RO['orderById']>>>;\n`;
const ASSERTED_GUARDS = `type _noMissing = AssertTrue<ExpectEqual<P_Missing, never>>;
type _noExtra = AssertTrue<ExpectEqual<P_Extra, never>>;`;

/** Drop `orderById` from the interface but leave it in the clause-key list (a real omission). */
function dropOrderById(source) {
  let out = replaceOnce(source, ORDER_BY_ID_MEMBER, '', 'drop orderById member');
  out = replaceOnce(out, ORDER_BY_ID_ROW, '', 'drop orderById NoWrites row');
  // The @ts-expect-error chain and p_startAtBound both call orderById; retarget them so the only
  // thing this mutation tests is the drift guard.
  out = replaceOnce(
    out,
    `await ro.whereId('==', 'x').orderById().startAt(1).endBefore(2).limit(1).delete();`,
    `await ro.whereId('==', 'x').startAt(1).endBefore(2).limit(1).delete();`,
    'retarget expect-error chain',
  );
  return out;
}

const MUTATIONS = [
  {
    id: 'M0',
    what: 'baseline — unmutated probe 03',
    mutate: s => s,
    expect: d => d.length === 0,
    expected: '0 diagnostics',
  },
  {
    id: 'M1',
    what: 'orderById dropped from the interface, drift guard written BARE (no AssertTrue)',
    mutate: s => replaceOnce(dropOrderById(s), ASSERTED_GUARDS, '', 'unassert the drift guards'),
    // The point of this row: NO diagnostic, even though Missing is demonstrably wrong.
    expect: (d, r) => d.length === 0 && r.some(l => l === 'P_Missing := "orderById"'),
    expected: '0 diagnostics AND P_Missing := "orderById"  (the guard is inert)',
  },
  {
    id: "M1'",
    what: 'same omission, drift guard ASSERTED',
    mutate: dropOrderById,
    expect: d => d.length === 1 && d[0].includes('TS2344'),
    expected: 'exactly 1 diagnostic, TS2344',
  },
  {
    id: 'M2',
    what: 'where() re-declared returning the FULL builder (the copy-paste slip)',
    mutate: s =>
      replaceOnce(
        s,
        `  where(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['where']>): ReadOnlyQuery<T, W, S, R>;`,
        `  where(...a: Parameters<FirestoreQueryBuilder<T, W, S, R>['where']>): FirestoreQueryBuilder<T, W, S, R>;`,
        'where returns full builder',
      ),
    // Key guards stay clean — which is exactly why the per-site NoWrites matrix is not redundant.
    expect: (d, r) =>
      d.some(x => x.includes('TS2344')) &&
      r.includes('P_Missing := never') &&
      r.includes('P_Extra := never'),
    expected: 'TS2344 present, yet P_Missing and P_Extra both still `never`',
  },
  {
    id: 'M3',
    what: "'where' misspelled 'wheer' in ReadOnlyQueryClauseKeys (Omit accepts any key)",
    mutate: s =>
      replaceOnce(
        s,
        "type ReadOnlyQueryClauseKeys =\n  | 'where'\n",
        "type ReadOnlyQueryClauseKeys =\n  | 'wheer'\n",
        'misspell where key',
      ),
    expect: d => d.some(x => x.includes('TS2430')),
    expected: 'TS2430 at the `extends` clause',
  },
];

let failures = 0;
for (const m of MUTATIONS) {
  const { diagnostics, resolved } = compileProbe(m.mutate(BASE));
  const ok = m.expect(diagnostics, resolved);
  if (!ok) failures += 1;
  console.log(`\n### ${m.id} — ${m.what}`);
  console.log(`    expected: ${m.expected}`);
  console.log(`    observed: ${diagnostics.length} diagnostic(s)`);
  for (const d of diagnostics) console.log(`      ${d}`);
  for (const line of resolved.filter(l => l.startsWith('P_Missing') || l.startsWith('P_Extra'))) {
    console.log(`      ${line}`);
  }
  console.log(`    ${ok ? 'PASS' : 'FAIL — expectation not met'}`);
}

console.log(
  `\n${failures === 0 ? 'ALL 5 EXPECTATIONS HOLD' : `${failures} EXPECTATION(S) FAILED`} ` +
    `(${MUTATIONS.length} mutations)`,
);
process.exit(failures === 0 ? 0 : 1);
