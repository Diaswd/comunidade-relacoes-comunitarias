import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withDeadline} from '../src/lib/request-deadline.ts';

test('a stalled session or network lookup times out and aborts the underlying request',async()=>{
 let signal;
 await assert.rejects(withDeadline(s=>{signal=s;return new Promise(()=>{})},{timeoutMs:10,message:'Consulta demorou'}),/Consulta demorou/);
 assert.equal(signal.aborted,true);
});
test('closing the review cancels it without waiting for the request to settle',async()=>{
 const controller=new AbortController();let signal;
 const pending=withDeadline(s=>{signal=s;return new Promise(()=>{})},{signal:controller.signal,timeoutMs:1000,message:'timeout'});
 await Promise.resolve();controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(signal.aborted,true);
});
test('a cancelled review never starts its request',async()=>{
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(withDeadline(async()=>{called=true},{signal:controller.signal,timeoutMs:1000,message:'timeout'}),{name:'AbortError'});
 assert.equal(called,false);
});
test('successful results and server failures are preserved',async()=>{
 assert.deepEqual(await withDeadline(async()=>['approved-member'],{timeoutMs:1000,message:'timeout'}),['approved-member']);
 await assert.rejects(withDeadline(async()=>{throw Error('Sem permissão')},{timeoutMs:1000,message:'timeout'}),/Sem permissão/);
});
