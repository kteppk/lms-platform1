const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function client(fetch) {
  const sandbox = { fetch, URL, location: { hostname: 'localhost' },
    firebase: { initializeApp() {}, auth() { return {}; } }, setTimeout: fn => fn() };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('firebase-config.js','utf8'),context);
  return (action,data) => sandbox.callFunction(action,data,{getIdToken:async()=> 'fixture-token'});
}
test('a transient worker failure is retried for a draft, but a business conflict is returned immediately', async () => {
  let calls=0;
  const call=client(async()=>({ok:false,status:++calls===1?546:409,json:async()=>({code:calls===1?'WORKER_RESOURCE_LIMIT':'conflict',error:'Конфликт'})}));
  await assert.rejects(call('saveStudentDraft',{}),e=>e.code==='conflict');
  assert.equal(calls,2);
});
test('creation is not retried after a lost response; reads have a bounded retry count', async () => {
  let calls=0;
  const call=client(async()=>{calls++;throw new Error('Network failure');});
  await assert.rejects(call('createTest',{})); assert.equal(calls,1);
  calls=0;
  await assert.rejects(call('listResults',{})); assert.equal(calls,3);
});
