// Build the runtime first. Package public assets and server code, never user data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||'.qa-output/vps-build');fs.mkdirSync(output,{recursive:true});
const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'sw-manifest.js'),'utf8')+';this.assets=OFFLINE_ASSETS',context);
const staticFiles=[...new Set([...context.assets.map(p=>p.split('?')[0]),'sw.js','sw-manifest.js','moved-sw.js','release.json','app-icon.svg','lite/index.html','lite/app.js','lite/lite.css','lite/config.json','lite/sw.js','online-history.js','online-history.css'])];
const walk=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.name==='node_modules'||e.isSymbolicLink()?[]:e.isDirectory()?walk(dir+'/'+e.name):e.name.startsWith('.env')?[]:[dir+'/'+e.name]);
const files=[...new Set([...staticFiles,...walk('server'),...walk('supabase/functions'),...walk('supabase/migrations')])];
for(const file of files)if(!path.resolve(root,file).startsWith(root+path.sep))throw Error('Invalid package path');
fs.writeFileSync(path.join(output,'static-list.txt'),staticFiles.join('\n')+'\n');fs.writeFileSync(path.join(output,'code-list.txt'),files.join('\n')+'\n');
cp.execFileSync('tar',['-czf',path.join(output,'code.tar.gz'),'-T',path.join(output,'code-list.txt')],{cwd:root});console.log('VPS code archive prepared.');
