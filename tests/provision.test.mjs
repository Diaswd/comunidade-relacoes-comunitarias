import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/provision-team/handler.ts';
const person={id:'member-1',name:'Pessoa fictícia',email:'person@example.test',version:1,existingAuthId:null,role:'Equipe'};
const password='Test-only-pass-123!';
const request=(body={password,members:[{id:person.id,version:1}]},auth='Bearer test-token',origin='https://diaswd.github.io')=>new Request('https://example.test/functions/v1/provision-team',{method:'POST',headers:{authorization:auth,origin,'content-type':'application/json'},body:JSON.stringify(body)});
function fixture(extra={}){const calls=[];return{calls,handler:createHandler({authenticate:async()=>true,pending:async()=>[person],create:async(email,pw)=>{calls.push(['create',email,pw]);return'auth-1'},link:async(_auth,m,id)=>calls.push(['link',m.id,id]),...extra})}}
test('provisioning rejects unauthenticated callers, wrong roles and other origins before Auth writes',async()=>{
 for(const options of [{authenticate:async()=>false},{pending:async()=>{throw Error('denied')}}]){const f=fixture(options),r=await f.handler(request());assert.ok([401,403].includes(r.status));assert.equal(f.calls.length,0)}
 const f=fixture();assert.equal((await f.handler(request(undefined,'','https://diaswd.github.io'))).status,401);
 assert.equal((await f.handler(request(undefined,undefined,'https://other.example'))).status,403);assert.equal(f.calls.length,0);
});
test('provisioning accepts only the reviewed members and versions',async()=>{
 const f=fixture();for(const body of [{password:'short',members:[{id:person.id,version:1}]},{password,members:[{id:'owner',version:1}]},{password,members:[{id:person.id,version:99}]},{password,members:[{id:person.id,version:1},{id:person.id,version:1}]}])assert.ok([400,409].includes((await f.handler(request(body))).status));
 assert.equal(f.calls.length,0);
});
test('new accounts receive the entered initial password without exposing it in responses',async()=>{
 const f=fixture(),r=await f.handler(request()),text=await r.text();
 assert.equal(r.status,200);assert.deepEqual(f.calls,[['create',person.email,password],['link',person.id,'auth-1']]);
 assert.equal(JSON.parse(text).results[0].status,'created');assert.ok(!text.includes(password));assert.equal(r.headers.get('cache-control'),'no-store');
});
test('existing accounts are linked without any password change',async()=>{
 const f=fixture({pending:async()=>[{...person,existingAuthId:'already-exists'}]});
 const r=await f.handler(request());assert.deepEqual(f.calls,[['link',person.id,'already-exists']]);assert.equal((await r.json()).results[0].status,'linked');
});
test('permissions are rechecked before each creation and failures never leak passwords',async()=>{
 let reads=0;const f=fixture({pending:async()=>{if(++reads>1)throw Error('revoked');return[person]}});
 const r=await f.handler(request());assert.equal((await r.json()).results[0].status,'failed');assert.equal(f.calls.length,0);
 const broken=fixture({create:async()=>{throw Error(password)}});const text=await(await broken.handler(request())).text();assert.ok(!text.includes(password));assert.equal(JSON.parse(text).results[0].status,'failed');
});
