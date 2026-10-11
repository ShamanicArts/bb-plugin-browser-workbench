import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
const source=resolve(process.argv[2] ?? '../bb-stuff/browser-workbench-core');
const require=createRequire(join(source,'apps/desktop/package.json'));
const {build}=require('esbuild');
const scratch=await mkdtemp(join(tmpdir(),'bb-workbench-run-'));
let display,child;
try {
  const fixture=join(scratch,'fixture.cjs');
  await build({entryPoints:[join(source,'apps/desktop/test/fixtures/browser-workbench-smoke.ts')],outfile:fixture,bundle:true,platform:'node',format:'cjs',conditions:['source'],external:['electron'],legalComments:'none'});
  display=spawn(process.env.BB_TEST_XVFB ?? 'Xvfb',['-displayfd','3','-screen','0','1280x1000x24','-nolisten','tcp'],{stdio:['ignore','ignore','pipe','pipe']});
  const number=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Virtual display startup timed out')),10000);
    const done=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
    display.once('error',error=>done(error));
    display.once('exit',code=>done(new Error(`Virtual display exited: ${code}`)));
    display.stdio[3].once('data',data=>done(null,String(data).trim()));
  });
  if(!/^\d+$/.test(number))throw new Error('Invalid virtual display number');
  const userData=join(scratch,'electron');await mkdir(userData);
  const env={...process.env,DISPLAY:`:${number}`,BB_WORKBENCH_SMOKE_USER_DATA:userData};
  delete env.WAYLAND_DISPLAY;delete env.ELECTRON_RUN_AS_NODE;delete env.BB_WORKBENCH_UI_PREVIEW_DIR;
  child=spawn(require('electron'),['--ozone-platform=x11','--disable-gpu',fixture],{cwd:scratch,env,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',data=>{output+=data;process.stdout.write(data);});
  child.stderr.on('data',data=>process.stderr.write(data));
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Native smoke timed out'));},35000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  if(code!==0)throw new Error(`Native smoke failed (${code})`);
  const receipt=JSON.parse(output.trim().split('\n').at(-1));
  if(receipt.ok!==true)throw new Error('Native smoke did not report success');
  if(process.argv[3])await writeFile(resolve(process.argv[3]),JSON.stringify(receipt,null,2)+'\n');
} finally {
  if(child?.exitCode===null)child.kill('SIGKILL');
  if(display?.pid && display.exitCode===null){display.kill();await new Promise(resolve=>display.once('exit',resolve));}
  await rm(scratch,{recursive:true,force:true});
}
