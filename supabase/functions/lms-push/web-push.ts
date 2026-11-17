// RFC 8291 aes128gcm and RFC 8292 VAPID; WebCrypto only (Deno/Node).
const utf8=(v:string)=>new TextEncoder().encode(v);
export const unbase=(v:string)=>Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const base=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const concat=(...values:Uint8Array[])=>{const out=new Uint8Array(values.reduce((n,v)=>n+v.length,0));let offset=0;for(const v of values){out.set(v,offset);offset+=v.length;}return out;};
async function hkdf(key:Uint8Array<ArrayBuffer>,salt:Uint8Array<ArrayBuffer>,info:Uint8Array<ArrayBuffer>,size:number){const imported=await crypto.subtle.importKey('raw',key,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},imported,size*8));}
export async function encryptPush(p256dh:string,auth:string,payload:string){
 const ua=unbase(p256dh),pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const pub=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),client=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:client},pair.privateKey,256));
 const ikm=await hkdf(shared,unbase(auth),concat(utf8('WebPush: info\0'),ua,pub),32),salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,utf8('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(ikm,salt,utf8('Content-Encoding: nonce\0'),12);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);const plain=concat(utf8(payload),new Uint8Array([2]));
 if(plain.length>3900)throw Error('Push payload too large');
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plain));
 return concat(salt,new Uint8Array([0,0,16,0,65]),pub,encrypted);
}
export async function vapid(endpoint:string,publicKey:string,privateKey:string,subject:string){
 const pub=unbase(publicKey);const jwk={kty:'EC',crv:'P-256',x:base(pub.slice(1,33)),y:base(pub.slice(33,65)),d:privateKey};
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const token=base(utf8(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+base(utf8(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+43200,sub:subject})));
 const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8(token)));return 'vapid t='+token+'.'+base(sig)+', k='+publicKey;
}
