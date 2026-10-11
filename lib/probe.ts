import { z } from "zod";

export const probeSchema = z.object({
  origin: z.string().max(2048),
  secure: z.boolean(),
  webgl: z.string().max(100),
  webgl2: z.string().max(100),
  webgpu: z.string().max(100),
  media: z.boolean(),
  midi: z.boolean(),
  permissions: z.array(z.object({ name: z.string().max(50), state: z.enum(["granted", "denied", "prompt", "Not queryable"]) })).max(12),
});
export type Probe = z.infer<typeof probeSchema>;

// Runs in BB's isolated page world. No persistent listeners, patches, device
// streams or GPU devices; contexts are released after the capability checks.
export const probeExpression = `(async () => {
  const gl = (name) => {
    let context;
    try {
      context = document.createElement('canvas').getContext(name);
      return context ? 'Available' : 'Unavailable';
    } catch { return 'Probe failed'; }
    finally { try { context?.getExtension('WEBGL_lose_context')?.loseContext(); } catch {} }
  };
  let webgpu = 'API unavailable';
  if (navigator.gpu) {
    let timer;
    try {
      const adapter = await Promise.race([
        navigator.gpu.requestAdapter(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 5000); })
      ]);
      webgpu = adapter ? (adapter.isFallbackAdapter ? 'Fallback adapter' : 'Adapter available') : 'No adapter';
    } catch { webgpu = 'Probe failed or timed out'; }
    finally { clearTimeout(timer); }
  }
  const permissions = await Promise.all([
    ['Microphone', {name: 'microphone'}],
    ['Camera', {name: 'camera'}],
    ['MIDI', {name: 'midi', sysex: false}],
    ['MIDI SysEx', {name: 'midi', sysex: true}],
    ['Notifications', {name: 'notifications'}],
    ['Location', {name: 'geolocation'}],
    ['Clipboard read', {name: 'clipboard-read'}]
  ].map(async ([name, descriptor]) => {
    try { return {name, state: (await navigator.permissions.query(descriptor)).state}; }
    catch { return {name, state: 'Not queryable'}; }
  }));
  return {origin: location.origin, secure: isSecureContext, webgl: gl('webgl'), webgl2: gl('webgl2'), webgpu,
    media: !!navigator.mediaDevices, midi: typeof navigator.requestMIDIAccess === 'function', permissions};
})()`;
