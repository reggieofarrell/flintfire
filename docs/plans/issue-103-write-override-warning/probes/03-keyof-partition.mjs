/**
 * Probe 03 — public instance member partition for the write/non-write drift guard.
 *
 * Proves via the TypeScript compiler API that `keyof FirestoreRepository<User>` is exactly the
 * 19 write methods ∪ 30 non-write public members (26 methods + 4 getters), so a two-sided
 * `Missing` / `Extra` type guard can pin the classification.
 *
 * Run (from repo root):
 *   node docs/plans/issue-103-write-override-warning/probes/03-keyof-partition.mjs
 */
import ts from 'typescript';
import fs from 'node:fs';

const WRITE = [
  'bulkCreate',
  'bulkCreateWithIds',
  'bulkDelete',
  'bulkPatch',
  'bulkUpdate',
  'bulkWrite',
  'create',
  'createInTransaction',
  'createWithId',
  'createWithIdInTransaction',
  'delete',
  'deleteInTransaction',
  'patch',
  'patchInTransaction',
  'recursiveDelete',
  'recursiveDeleteCollection',
  'update',
  'updateInTransaction',
  'upsert',
];

const NON_WRITE = [
  'collectionGroup',
  'createSchema',
  'findByField',
  'fromSnapshot',
  'getAll',
  'getById',
  'getByIdOrThrow',
  'getByIdWithUpdateTime',
  'getCollectionPath',
  'getInTransaction',
  'getMany',
  'getManyInTransaction',
  'getOneByField',
  'getOneByFieldOrThrow',
  'getParentId',
  'id',
  'isSubcollection',
  'listenOne',
  'listenOneDetailed',
  'newId',
  'on',
  'query',
  'readSchema',
  'runInTransaction',
  'runReadOnlyAt',
  'safeValidate',
  'schemas',
  'subcollection',
  'updateSchema',
  'validate',
];

const fileName = 'src/tests/types/__probe_103_partition.type-test.ts';
const code = `
import { FirestoreRepository } from '../../index.js';
type User = { name: string };
type Repo = FirestoreRepository<User>;
export type Keys = keyof Repo;
`;

const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.typecheck.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, '.');

const host = ts.createCompilerHost(parsed.options);
const origGet = host.getSourceFile.bind(host);
const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
host.getSourceFile = (fn, ...a) => (fn === fileName || fn.endsWith(fileName) ? sf : origGet(fn, ...a));
host.fileExists = fn => fn === fileName || fn.endsWith(fileName) || ts.sys.fileExists(fn);
host.readFile = fn => (fn === fileName || fn.endsWith(fileName) ? code : ts.sys.readFile(fn));

const program = ts.createProgram({
  rootNames: [...parsed.fileNames, fileName],
  options: parsed.options,
  host,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(fileName);
let keys = [];
for (const stmt of source.statements) {
  if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'Keys') {
    const typ = checker.getTypeFromTypeNode(stmt.type);
    // typeToString on a string-literal union member prints quotes (`"update"`); strip them so
    // set membership against the bare WRITE / NON_WRITE lists works.
    const raw = typ.isUnion()
      ? typ.types.map(t => checker.typeToString(t))
      : [checker.typeToString(typ)];
    keys = raw.map(s => s.replace(/^"|"$/g, '')).sort();
  }
}

const writeSet = new Set(WRITE);
const nonWriteSet = new Set(NON_WRITE);
const missing = keys.filter(k => !writeSet.has(k) && !nonWriteSet.has(k));
const extraWrite = WRITE.filter(k => !keys.includes(k));
const extraNonWrite = NON_WRITE.filter(k => !keys.includes(k));

console.log('keyof count', keys.length);
console.log('write', WRITE.length, 'nonWrite', NON_WRITE.length);
console.log('missing', JSON.stringify(missing));
console.log('extraWrite', JSON.stringify(extraWrite));
console.log('extraNonWrite', JSON.stringify(extraNonWrite));

// Also confirm AST public-instance method count matches issue list ∩ class.
const repoSrc = fs.readFileSync('src/core/FirestoreRepository.ts', 'utf8');
const sfRepo = ts.createSourceFile(
  'src/core/FirestoreRepository.ts',
  repoSrc,
  ts.ScriptTarget.Latest,
  true,
);
let pubMethods = [];
function visit(node) {
  if (ts.isClassDeclaration(node) && node.name?.text === 'FirestoreRepository') {
    for (const m of node.members) {
      if (!ts.isMethodDeclaration(m)) continue;
      const name = m.name && ts.isIdentifier(m.name) ? m.name.text : null;
      if (!name) continue;
      const mods = m.modifiers ?? [];
      const isPrivate = mods.some(x => x.kind === ts.SyntaxKind.PrivateKeyword);
      const isProtected = mods.some(x => x.kind === ts.SyntaxKind.ProtectedKeyword);
      const isStatic = mods.some(x => x.kind === ts.SyntaxKind.StaticKeyword);
      if (isPrivate || isProtected || isStatic) continue;
      if (!pubMethods.includes(name)) pubMethods.push(name);
    }
  }
  ts.forEachChild(node, visit);
}
visit(sfRepo);
pubMethods.sort();
const writeOnClass = WRITE.filter(w => pubMethods.includes(w));
console.log('public instance methods', pubMethods.length);
console.log('write methods present on class', writeOnClass.length);

let failed = false;
if (missing.length || extraWrite.length || extraNonWrite.length) failed = true;
if (keys.length !== 49) {
  console.error('FAIL keyof count', keys.length);
  failed = true;
}
if (writeOnClass.length !== 19) {
  console.error('FAIL write on class', writeOnClass.length);
  failed = true;
}
if (failed) process.exit(1);
console.log('OK');
