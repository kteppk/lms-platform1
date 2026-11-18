import {scrypt as derive,randomBytes,timingSafeEqual,createCipheriv} from 'node:crypto';import {promisify} from 'node:util';
const scrypt=promisify(derive);const equal=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);
export async function hashPassword(password){const salt=randomBytes(24);const hash=await scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});return {algorithm:'scrypt',salt:salt.toString('base64'),hash:hash.toString('base64'),N:32768,r:8,p:1};}
export async function verifyPassword(password,record,config){
 if(!record||typeof password!=='string')return false;
 if(record.algorithm==='firebase-scrypt'){
  if(!config||config.algorithm!=='SCRYPT'||config.memoryCost<1||config.memoryCost>18||config.rounds<1||config.rounds>16)return false;
  const salt=Buffer.concat([Buffer.from(record.salt,'base64'),Buffer.from(config.saltSeparator,'base64')]);
  const key=await scrypt(password,salt,32,{N:2**config.memoryCost,r:config.rounds,p:1,maxmem:256*1024*1024});
  const cipher=createCipheriv('aes-256-ctr',key,Buffer.alloc(16));return equal(Buffer.concat([cipher.update(Buffer.from(config.signerKey,'base64')),cipher.final()]),Buffer.from(record.hash,'base64'));
 }
 if(record.algorithm==='scrypt'){const hash=await scrypt(password,Buffer.from(record.salt,'base64'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});return equal(hash,Buffer.from(record.hash,'base64'));}return false;
}
