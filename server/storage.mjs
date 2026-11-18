import fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import {Readable} from 'node:stream';import path from 'node:path';import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
const allowed={
 'lms-lectures':{max:50*1024*1024,types:['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','video/mp4','text/html']},
 'lms-books':{max:50*1024*1024,types:['application/pdf']},'lms-profiles':{max:10*1024*1024,types:['application/pdf','image/jpeg','image/png','image/webp']},
 'lms-photos':{max:10*1024*1024,types:['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp','image/tiff']}
};
export function createStorage({root,secret,publicURL}){
 root=path.resolve(root);const mac=s=>createHmac('sha256',secret).update(s).digest('base64url');
 function location(bucket,key){if(!allowed[bucket]||typeof key!=='string'||key.length>1000||key.split('/').some(k=>!k||k==='.'||k==='..'||/[\\\x00-\x1f]/.test(k)))throw Error('Invalid storage path');const file=path.resolve(root,bucket,...key.split('/'));if(!file.startsWith(root+path.sep))throw Error('Invalid storage path');return file;}
 function token(bucket,key,mode,seconds){const body=Buffer.from(JSON.stringify({bucket,key,mode,exp:Math.floor(Date.now()/1000)+seconds})).toString('base64url');return body+'.'+mac(body);}
 function verify(value,bucket,key,mode){if(typeof value!=='string'||value.length>4000)return false;const [body,signature]=value.split('.');if(!body||!signature)return false;const a=Buffer.from(mac(body)),b=Buffer.from(signature);if(a.length!==b.length||!timingSafeEqual(a,b))return false;try{const c=JSON.parse(Buffer.from(body,'base64url'));return c.bucket===bucket&&c.key===key&&c.mode===mode&&c.exp>Math.floor(Date.now()/1000);}catch{return false;}}
 const url=(bucket,key,mode,seconds)=>publicURL+'/storage/v1/'+(mode==='upload'?'upload/':'object/sign/')+bucket+'/'+key.split('/').map(encodeURIComponent).join('/')+'?token='+token(bucket,key,mode,seconds);
 async function info(bucket,key){try{const file=location(bucket,key),stat=await fs.stat(file),meta=JSON.parse(await fs.readFile(file+'.meta.json','utf8'));return {data:{contentType:meta.mime,size:stat.size},error:null};}catch{return {data:null,error:null};}}
 const storage={from(bucket){if(!allowed[bucket])throw Error('Unknown bucket');return {
  createSignedUploadUrl:async key=>{location(bucket,key);return {data:{signedUrl:url(bucket,key,'upload',900)},error:null};},
  createSignedUrls:async(keys,seconds=3600)=>({data:await Promise.all(keys.map(async key=>{const found=await info(bucket,key);return found.data?{path:key,signedUrl:url(bucket,key,'read',Math.min(seconds,3600))}:{path:key,error:'Object not found'};})),error:null}),
  info:key=>info(bucket,key),exists:async key=>({data:!!(await info(bucket,key)).data,error:null}),
  remove:async keys=>{for(const key of keys){const file=location(bucket,key);await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.unlink(file+'.meta.json').catch(()=>{});}return {data:[],error:null};}
 };}};
 async function handle(request){
  const u=new URL(request.url),match=u.pathname.match(/^\/storage\/v1\/(upload|object\/sign)\/([^/]+)\/(.+)$/);if(!match)return new Response(null,{status:404});
  let bucket,key,file;try{bucket=decodeURIComponent(match[2]);key=match[3].split('/').map(decodeURIComponent).join('/');file=location(bucket,key);}catch{return new Response(null,{status:400});}
  const upload=match[1]==='upload';if(!verify(u.searchParams.get('token'),bucket,key,upload?'upload':'read'))return new Response(null,{status:403});
  if(upload){if(request.method!=='PUT')return new Response(null,{status:405});try{
   const form=await request.formData(),blob=form.get('');if(!blob||typeof blob.arrayBuffer!=='function'||blob.size<1||blob.size>allowed[bucket].max||!allowed[bucket].types.includes(blob.type))return new Response(null,{status:400});
   const bytes=new Uint8Array(await blob.arrayBuffer());await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});await fs.writeFile(file+'.meta.json',JSON.stringify({mime:blob.type,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}),{mode:0o600});return Response.json({ok:true});
  }catch(e){return new Response(null,{status:e.code==='EEXIST'?409:400});}}
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
  try{const stat=await fs.stat(file),meta=JSON.parse(await fs.readFile(file+'.meta.json','utf8')),safeInline=/^(image\/(jpeg|png|webp|gif)|video\/mp4|application\/pdf)$/.test(meta.mime),download=u.searchParams.get('download');
   const name=(download||key.split('/').at(-1)).replace(/[\r\n"\\]/g,'_').slice(0,250),headers={'Content-Type':meta.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=300','Accept-Ranges':'bytes','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':(download!==null||!safeInline?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(name)};
   const range=request.headers.get('range');if(range){const m=range.match(/^bytes=(\d*)-(\d*)$/);if(!m||!m[1]&&!m[2])return new Response(null,{status:416});const start=m[1]?Number(m[1]):Math.max(0,stat.size-Number(m[2])),end=m[1]?(m[2]?Math.min(stat.size-1,Number(m[2])):stat.size-1):stat.size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size)return new Response(null,{status:416});headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;headers['Content-Length']=String(end-start+1);return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file,{start,end})),{status:206,headers});}
   headers['Content-Length']=String(stat.size);return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file)),{headers});
  }catch{return new Response(null,{status:404});}
 }
 return {storage,handle,location};
}
