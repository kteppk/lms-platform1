const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),lite=path.join(root,'lite'),release=require(path.join(root,'release.json'));
const config=require(path.join(lite,'config.json')),api=process.env.LMS_LITE_API_URL||config.apiUrl;
const esc=s=>String(s).replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
const replace=s=>s.replaceAll('__VERSION__',release.version).replaceAll('__API_URL__',esc(api)).replaceAll('__MAIN_URL__',esc(config.mainUrl)).replaceAll('__MIRROR_URL__',esc(config.mirrorUrl||'#')).replaceAll('__MIRROR_HIDDEN__',config.mirrorUrl?'':'hidden');
const html=replace(fs.readFileSync(path.join(lite,'index.template.html'),'utf8'));
fs.writeFileSync(path.join(lite,'index.html'),html);fs.writeFileSync(path.join(lite,'sw.js'),replace(fs.readFileSync(path.join(lite,'sw.template.js'),'utf8')));
const files=['index.html','lite.css','app.js','sw.js'],assets={};let size=0;
for(const file of files){let body=fs.readFileSync(path.join(lite,file),'utf8');if(file==='index.html')body=body.replace('data-api="'+esc(api)+'"','data-api="/api"');assets['/'+file]={body,type:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',etag:'"'+crypto.createHash('sha256').update(body).digest('hex')+'"'};if(file!=='sw.js')size+=Buffer.byteLength(body);}
if(size>30000)throw Error('Lite shell exceeds 30 KB budget: '+size);
const worker=fs.readFileSync(path.join(lite,'mirror-runtime.mjs'),'utf8')+'\nconst assets='+JSON.stringify(assets)+';\nexport default createMirrorHandler(assets,{version:'+JSON.stringify(release.version)+'});\n';
const folder=path.join(root,'.mirror-site');fs.mkdirSync(path.join(folder,'worker'),{recursive:true});fs.mkdirSync(path.join(folder,'scripts'),{recursive:true});fs.writeFileSync(path.join(folder,'worker/index.js'),worker);
fs.writeFileSync(path.join(folder,'scripts/build.mjs'),"import fs from 'node:fs';\nfs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});fs.copyFileSync('worker/index.js','dist/server/index.js');fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');\n");
console.log('Lite '+release.version+': '+size+' bytes HTML+CSS+JS, no Firebase, fonts or images. Mirror Worker prepared.');
