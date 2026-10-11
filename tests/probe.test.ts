import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { probeExpression, probeSchema } from '../lib/probe.ts';

test('capability probe releases WebGL contexts and never requests media or MIDI', async () => {
  let released=0;
  const result=await runInNewContext(probeExpression, {
    navigator: {gpu:{requestAdapter:async()=>({isFallbackAdapter:true})}, permissions:{query:async()=>({state:'denied'})},mediaDevices:{getUserMedia(){throw new Error('Must not request a device');}},requestMIDIAccess(){throw new Error('Must not request MIDI');}},
    document:{createElement:()=>({getContext:()=>({getExtension:()=>({loseContext(){released++;}})})})},
    location:{origin:'https://studio.test'},isSecureContext:true,setTimeout,clearTimeout,
  });
  const value=probeSchema.parse(result);
  assert.equal(value.webgpu,'Fallback adapter');assert.equal(released,2);assert.equal(value.permissions.length,7);
});
test('unsupported APIs report unavailable instead of inventing grants', async () => {
  const result=await runInNewContext(probeExpression, {navigator:{},document:{createElement:()=>({getContext:()=>null})},location:{origin:'null'},isSecureContext:false,setTimeout,clearTimeout});
  const value=probeSchema.parse(result);
  assert.equal(value.webgpu,'API unavailable');assert.equal(value.webgl,'Unavailable');assert(value.permissions.every(p=>p.state==='Not queryable'));
});
