const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function storage(){const s={};Object.defineProperties(s,{getItem:{value:k=>s[k]??null},setItem:{value:(k,v)=>{s[k]=String(v);}},removeItem:{value:k=>{delete s[k];}}});return s;}
function client(){
 const localStorage=storage(),sessionStorage=storage(),events=[];
 const sandbox={localStorage,sessionStorage,navigator:{onLine:true},Date,Map,Set,JSON,Object,Promise,CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail;}},setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),clearTimeout,
  document:{addEventListener(){},dispatchEvent:e=>events.push(e)},window:{addEventListener(){}},location:{}};
 const context=vm.createContext(sandbox);vm.runInContext(fs.readFileSync('connection.js','utf8')+'\nthis.client=AppConnection;',context);return {...sandbox,connection:sandbox.client,events};
}
test('reference cache is bounded to safe actions and the current user; private results/profile are never persisted',async()=>{
 const c=client(),a={uid:'first'};let calls=0;
 const send=async()=>{calls++;return [{id:'subject',title:'Математика'}];};
 await c.connection.request('listSubjects',{},a,send);assert.equal(calls,1);
 await c.connection.request('listSubjects',{},a,send);assert.equal(calls,1);
 await c.connection.request('profile',{},a,async()=>({role:'admin',email:'private@example.test'}));
 await c.connection.request('listResults',{},a,async()=>({answers:'private-answer'}));
 assert.ok(!JSON.stringify(c.localStorage).includes('private'));
 c.navigator.onLine=false;assert.equal((await c.connection.request('listSubjects',{},a,send))._offline.stale,true);
 await assert.rejects(c.connection.request('listResults',{},a,send),e=>e.code==='unavailable');
 await assert.rejects(c.connection.request('listSubjects',{}, {uid:'second'},send),e=>e.code==='unavailable');assert.equal(c.connection.savedSchedules().length,0);
});
test('slow reference reads return a dated copy then refresh; business conflicts do not fall back',async()=>{
 const c=client(),a={uid:'s'};
 await c.connection.request('getWeeklySchedule',{groupId:'g'},a,async()=>({group:{id:'g',name:'9241'},cells:[]}));
 let finish;const pending=new Promise(resolve=>finish=resolve);
 c.connection.invalidate();const copy=await c.connection.request('getWeeklySchedule',{groupId:'g'},a,()=>pending);assert.equal(copy._offline.stale,true);assert.ok(copy._offline.savedAt);
 finish({group:{id:'g',name:'9241'},cells:[{title:'Замена'}]});await new Promise(r=>setTimeout(r,1));assert.equal(c.events[0].type,'lms-reference-updated');
 assert.equal(c.connection.peek('getWeeklySchedule',{groupId:'g'}).value.cells[0].title,'Замена');
 await assert.rejects(c.connection.request('getWeeklySchedule',{groupId:'g'},a,async()=>{throw Object.assign(new Error('Denied'),{code:'permission-denied'});},{fresh:true}),e=>e.code==='permission-denied');
});
test('shared device uses session storage; logout clears reference data and local drafts; late responses cannot repopulate it',async()=>{
 const c=client(),a={uid:'s'};c.connection.rememberDevice(false);
 await c.connection.request('listSubjects',{},a,async()=>[]);assert.ok(Object.keys(c.sessionStorage).some(k=>k.startsWith('lms-reference-v1:')));assert.ok(!Object.keys(c.localStorage).some(k=>k.startsWith('lms-reference-v1:')));
 c.localStorage.setItem('lms-attempt-s-work','draft');assert.equal(c.connection.hasDrafts('s'),true);
 let finish;const task=c.connection.request('listScheduleGroups',{},a,()=>new Promise(resolve=>finish=resolve));
 c.connection.clearUser('s');finish([{id:'g'}]);await task;
 assert.ok(!Object.keys(c.localStorage).some(k=>k.startsWith('lms-attempt-s')));assert.ok(!Object.keys(c.sessionStorage).some(k=>k.startsWith('lms-reference-v1:')));
});
test('offline writes are rejected without queueing; simultaneous reads share one request and writes invalidate freshness',async()=>{
 const c=client(),a={uid:'s'};let calls=0,finish;
 const send=()=>{calls++;return new Promise(r=>finish=r);};
 const first=c.connection.request('listSubjects',{},a,send),second=c.connection.request('listSubjects',{},a,send);assert.equal(calls,1);finish([]);await Promise.all([first,second]);
 await c.connection.request('saveSubject',{},a,async()=>({id:'new'}));assert.equal(c.connection.peek('listSubjects',{}).refresh,true);
 c.navigator.onLine=false;await assert.rejects(c.connection.request('submitStudentTest',{},a,async()=>{calls++;}),e=>e.code==='unavailable');assert.equal(calls,1);
});
test('generated offline manifest is valid, contains local SDK and no external/API/storage endpoints',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync('sw-manifest.js','utf8')+';this.assets=OFFLINE_ASSETS;',context);
 assert.ok(context.assets.some(p=>p.startsWith('vendor/firebase/')));assert.ok(context.assets.includes('offline.html'));
 for(const file of context.assets){assert.ok(!/^https?:/.test(file));assert.ok(!file.includes('/functions/v1/')&&!file.includes('/storage/v1/'));assert.ok(fs.existsSync(file.split('?')[0]),file);}
 new vm.Script(fs.readFileSync('sw.js','utf8'));
});
