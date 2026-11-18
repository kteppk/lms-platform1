// Local authentication adapter. Existing cabinet code keeps the same small API.
(()=>{
 if(window.firebase)return;let current=null,token=null,expiresAt=0,persistent=true,refreshing=null;const listeners=new Set(),pending='lms-logout-pending';
 const event=(type)=>{try{localStorage.setItem('lms-auth-event',JSON.stringify({type,time:Date.now()}));}catch{}};
 async function request(action,data,method='POST'){
  let response;try{response=await fetch('/auth/'+action,{method,credentials:'same-origin',cache:'no-store',headers:method==='POST'?{'Content-Type':'application/json'}:{},...(method==='POST'?{body:JSON.stringify(data??{})}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Не удалось связаться с сервером входа.'),{code:'auth/network-request-failed'});}
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'Не удалось войти.'),{code:result.code});return result;
 }
 function user(data){return {...data,getIdToken:async(force=false)=>{if(!current||current.uid!==data.uid)throw Object.assign(Error('Войдите в аккаунт.'),{code:'auth/requires-recent-login'});if(force||Date.now()>=expiresAt){refreshing??=request('session',null,'GET').then(r=>{apply(r);if(!r.user)throw Object.assign(Error('Войдите заново.'),{code:'auth/requires-recent-login'});return token;}).finally(()=>refreshing=null);return refreshing;}return token;},updateProfile:async values=>{apply(await request('profile',values));},reauthenticateWithCredential:async credential=>{apply(await request('reauth',credential));},updatePassword:async password=>{apply(await request('password',{password}));},delete:async()=>{await request('delete');apply({user:null},true);}};}
 function apply(result,notify=false){current=result.user?user(result.user):null;token=result.token??null;expiresAt=result.expiresAt??0;if(notify)for(const cb of listeners)queueMicrotask(()=>cb(current));return {user:current};}
 async function initialize(notify=false){try{if(localStorage.getItem(pending)){await request('logout').catch(e=>{if(e.code==='auth/network-request-failed')throw e;});localStorage.removeItem(pending);}apply(await request('session',null,'GET'),notify);}catch{apply({user:null},notify);}}
 const initial=initialize();
 const instance={get currentUser(){return current;},onAuthStateChanged(callback){listeners.add(callback);initial.then(()=>{if(listeners.has(callback))callback(current);});return ()=>listeners.delete(callback);},setPersistence:async value=>{persistent=value==='local';},
  signInWithEmailAndPassword:async(email,password)=>{await initial;const r=apply(await request('login',{email,password,persistent}),true);event('login');return r;},
  createUserWithEmailAndPassword:async(email,password)=>{await initial;const r=apply(await request('signup',{email,password,persistent}),true);event('login');return r;},
  signOut:async()=>{try{await request('logout');try{localStorage.removeItem(pending);}catch{}}catch(e){if(e.code==='auth/network-request-failed')try{localStorage.setItem(pending,'1');}catch{}else if(e.code!=='auth/requires-recent-login')throw e;}apply({user:null},true);event('logout');},
  sendPasswordResetEmail:async email=>{await request('recover',{email});}
 };
 const getter=()=>instance;getter.EmailAuthProvider={credential:(email,password)=>({email,password})};getter.Auth={Persistence:{LOCAL:'local',SESSION:'session'}};
 window.firebase={initializeApp(){},auth:getter};window.LocalAuthentication={completeReset:(resetToken,password)=>request('reset',{token:resetToken,password})};
 window.addEventListener('storage',e=>{if(e.key==='lms-auth-event'){let item;try{item=JSON.parse(e.newValue);}catch{}if(item?.type==='logout')apply({user:null},true);else if(item?.type==='login')initialize(true);}});
})();
