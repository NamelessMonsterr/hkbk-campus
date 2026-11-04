'use strict';
const vm=require('vm'),fs=require('fs');const source=fs.readFileSync(__dirname+'/../js/gemini-live.js','utf8');
(async()=>{let pass=0;const check=(s,x)=>{if(!x)throw Error(s);pass++;console.log('PASS',s)};
for(const kind of ['permission','resume']){let tracks=0;const stream={getTracks:()=>[{stop:()=>tracks++}]};let late;
const ctx={console,Promise,Uint8Array,Int16Array,Float32Array,setTimeout:(f,ms)=>setTimeout(f,ms>=8000?5:ms),clearTimeout,navigator:{mediaDevices:{getUserMedia:()=>kind==='permission'?new Promise(r=>late=r):Promise.resolve(stream)}},AudioContext:function(){this.resume=()=>new Promise(()=>{});this.close=()=>Promise.resolve();}};ctx.globalThis=ctx;vm.runInNewContext(source,ctx);const s=new ctx.HKBKGeminiLive.LiveSession({endpoint:'x'});let err;try{await s.start()}catch(e){err=e.message};check(kind+' startup timeout is explicit',err===(kind==='permission'?'microphone_permission_timeout':'audio_start_timeout'));check(kind+' timeout closes session',s.closed===true);if(late){late(stream);await Promise.resolve();await Promise.resolve();}check(kind+' late/current track released',tracks>=1);
}
console.log(pass+' passed, 0 failed');})().catch(e=>{console.error(e);process.exit(1)});
