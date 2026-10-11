import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { fallbackExpression } from '../lib/repl.ts';
import { previewSummary } from '../lib/repl-format.ts';

const page = (options?: { strings: boolean }) => {
  const context = createContext({}, options && { codeGeneration: { strings: options.strings, wasm: true } });
  runInContext('globalThis.calls = 0', context);
  return {
    run: async (source: string) => JSON.parse(JSON.stringify(await runInContext(fallbackExpression(source), context))),
    calls: () => runInContext('calls', context),
  };
};

test('fallback console runs input exactly once, even when user code throws SyntaxError or EvalError', async () => {
  const p = page();
  const rejected = await p.run('await Promise.reject((calls++, new SyntaxError("invalid JSON")))');
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /^Uncaught SyntaxError: invalid JSON/);
  assert.equal(p.calls(), 1);
  const thrown = await p.run('calls++; throw new EvalError("nope")');
  assert.match(thrown.error, /^Uncaught EvalError: nope/);
  assert.equal(p.calls(), 2);
  assert.match((await p.run('1 +')).error, /^Uncaught SyntaxError/);
});

test('fallback console handles await, statements and global declarations', async () => {
  const p = page();
  assert.deepEqual(await p.run('const v = await Promise.resolve(7); v * 2'), { ok: true, value: { type: 'number', text: '14' } });
  await p.run('var kept = 3');
  assert.deepEqual(await p.run('kept + 1'), { ok: true, value: { type: 'number', text: '4' } });
  assert.deepEqual(await p.run('"hi"'), { ok: true, value: { type: 'string', text: '"hi"' } });
});

test('fallback previews never run getters and read a bounded number of items', async () => {
  const p = page();
  const object = await p.run('({ get g() { calls++; return 1 }, a: [1, {b: 2}], m: new Map([[1, "x"]]) })');
  assert.equal(object.value.text, '{g: (...), a: (2) [1, {b: 2}], m: Map(1) {1 => "x"}}');
  assert.equal(p.calls(), 0);
  const big = await p.run('globalThis.reads = 0; new Proxy({ length: 10000, item() {} }, { get(t, k) { if (/^\\d+$/.test(String(k))) reads++; return t[k]; }, getOwnPropertyDescriptor(t, k) { if (/^\\d+$/.test(String(k))) reads++; return Reflect.getOwnPropertyDescriptor(t, k); } })');
  assert.match(big.value.text, /\(10000\) \[/);
  assert.ok((await p.run('reads')).value.text <= 100);
});

test('fallback reports CSP-blocked compilation without running anything', async () => {
  const p = page({ strings: false });
  assert.deepEqual(await p.run('calls++'), { csp: true });
  assert.equal(p.calls(), 0);
});

test('native previews summarise like DevTools', () => {
  assert.equal(previewSummary({ type: 'object', overflow: false, description: 'Object', properties: [
    { name: 'x', type: 'number', value: '1' }, { name: 'g', type: 'accessor' }, { name: 's', type: 'string', value: 'a"b' },
  ] }), '{x: 1, g: (...), s: "a\\"b"}');
  assert.equal(previewSummary({ type: 'object', subtype: 'array', description: 'Array(10000)', overflow: true, properties: [
    { name: '0', type: 'number', value: '0' }, { name: '1', type: 'object', value: 'Array(2)', subtype: 'array' },
  ] }), '(10000) [0, Array(2), …]');
  assert.equal(previewSummary({ type: 'object', subtype: 'map', description: 'Map(1)', overflow: false, properties: [],
    entries: [{ key: { type: 'number', description: '1', overflow: false, properties: [] }, value: { type: 'object', description: 'Object', overflow: false, properties: [{ name: 'deep', type: 'boolean', value: 'true' }] } }],
  }), 'Map(1) {1 => {deep: true}}');
});
