import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createRealtime,permittedTopics} from '../server/realtime.mjs';
const origin='https://lms.example.test',delay=ms=>new Promise(r=>setTimeout(r,ms));
class Response extends EventEmitter{constructor(){super();this.output='';this.writableLength=0;this.destroyed=false;}writeHead(status,headers){this.status=status;this.headers=headers;}write(value){this.output+=value;return true;}end(){this.destroyed=true;this.emit('close');}destroy(){this.end();}}
function harness(){const sessions=new Map([['curator',{id:'c',role:'curator'}],['student',{id:'s',role:'student'}],['admin',{id:'a',role:'admin'}]]);
 const pool={query:async(sql,args)=>({rows:sql.includes('token_hash')?args[0].flatMap(hash=>sessions.has(hash)?[{token_hash:hash,...sessions.get(hash)}]:[]):[...sessions.values()].filter(s=>s.id===args[0]).map(s=>({role:s.role}))})};
 const listener=new EventEmitter();listener.connect=async()=>{};listener.query=async()=>{};listener.end=async()=>{};
 const hub=createRealtime({pool,publicURL:origin,batchMs:1,heartbeatMs:10000,createListener:()=>listener,authenticate:async r=>{const hash=r.headers.get('cookie');return sessions.has(hash)?{uid:sessions.get(hash).id,sessionHash:hash}:null;}});
 async function open(cookie,path='',headers={}){const res=new Response();await hub.handle(new Request(origin+'/events'+path,{headers:{...(cookie?{Cookie:cookie}:{}),...headers}}),{headers:{},socket:{remoteAddress:'test'}},res);return res;}
 return {sessions,hub,open,listener};
}
test('public and private invalidations follow role, current group and exact recipient',()=>{
 const guest={role:'guest',groupId:'g'},student={uid:'s',role:'student',groupId:'g'},curator={uid:'c',role:'curator',groupId:'g'};
 assert.deepEqual(permittedTopics({kind:'news'},guest),['news']);assert.deepEqual(permittedTopics({kind:'schedule',groupId:'other'},student),[]);assert.deepEqual(permittedTopics({kind:'schedule',groupId:'g'},guest),['schedule']);
 for(const role of ['guest','student','teacher'])assert.deepEqual(permittedTopics({kind:'chat'},{uid:'s',role}),[]);
 assert.deepEqual(permittedTopics({kind:'chat'},curator),['chat']);assert.deepEqual(permittedTopics({kind:'notices',userId:'other'},student),[]);assert.deepEqual(permittedTopics({kind:'notices',userId:'s'},student),['notices']);
 assert.deepEqual(permittedTopics({kind:'accounts'},student),[]);assert.deepEqual(permittedTopics({kind:'results',userId:'other',teacherId:'s'},student),[]);
 assert.deepEqual(permittedTopics({kind:'results',userId:'s'},student),['results']);assert.deepEqual(permittedTopics({kind:'content'},guest),[]);
});
test('SSE rejects cross-origin access and URL credentials; anonymous stream is explicitly public',async()=>{
 const h=harness();await h.hub.start();try{
  assert.equal((await h.open(null)).status,401);assert.equal((await h.open(null,'?public=1')).status,200);
  assert.equal((await h.open('student','',{Origin:'https://evil.example'})).status,403);assert.equal((await h.open('student','?token=secret')).status,400);assert.equal((await h.open('student','?group=../private')).status,400);
 }finally{await h.hub.close();}
});
test('open streams recheck roles before sending: a demoted curator gets no chat signal',async()=>{
 const h=harness();await h.hub.start();try{await delay(5);const c=await h.open('curator'),s=await h.open('student');c.output='';s.output='';h.sessions.set('curator',{id:'c',role:'student'});h.hub.publish({kind:'chat'});await delay(15);
  assert.match(c.output,/event: permissions/);assert.doesNotMatch(c.output,/"chat"/);assert.equal(c.destroyed,true);assert.doesNotMatch(s.output,/"chat"/);
 }finally{await h.hub.close();}
});
test('logout invalidates only the revoked session and events contain no message contents',async()=>{
 const h=harness();await h.hub.start();try{await delay(5);const c=await h.open('curator'),s=await h.open('student');c.output='';s.output='';h.sessions.delete('curator');h.hub.publish({kind:'session',userId:'c'});h.hub.publish({kind:'notices',userId:'s',body:'PRIVATE SHOULD NEVER APPEAR'});await delay(15);
  assert.match(c.output,/event: session/);assert.doesNotMatch(c.output,/"notices"/);assert.match(s.output,/"notices"/);assert.doesNotMatch(s.output,/PRIVATE|token_hash|student|curator/);
 }finally{await h.hub.close();}
});
test('only the selected group reaches a guest; a lost database listener closes stale streams',async()=>{
 const h=harness();await h.hub.start();try{await delay(5);const g=await h.open(null,'?public=1&group=g');g.output='';h.hub.publish({kind:'schedule',groupId:'other'});await delay(10);assert.equal(g.output,'');h.hub.publish({kind:'schedule',groupId:'g'});await delay(10);assert.match(g.output,/"schedule"/);h.listener.emit('error',new Error('offline'));assert.equal(g.destroyed,true);
 }finally{await h.hub.close();}
});
