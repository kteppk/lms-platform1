// Run with the development Node.js before uploading. Production needs only JS.
const fs=require('node:fs'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..'),source=path.join(root,'supabase/functions'),target=path.join(root,'server/runtime');
function build(dir=''){
 for(const entry of fs.readdirSync(path.join(source,dir),{withFileTypes:true})){
  const relative=path.join(dir,entry.name);
  if(entry.isDirectory()){build(relative);continue;}
  if(!/\.(?:ts|mjs)$/.test(entry.name))continue;
  const output=path.join(target,relative.replace(/\.ts$/,'.mjs'));fs.mkdirSync(path.dirname(output),{recursive:true});
  let text=fs.readFileSync(path.join(source,relative),'utf8');
  if(entry.name.endsWith('.ts'))text=stripTypeScriptTypes(text,{mode:'transform'}).replace(/(['"])(\.[^'"\n]+)\.ts\1/g,'$1$2.mjs$1');
  fs.writeFileSync(output,text);
 }
}
build();console.log('VPS JavaScript runtime built.');
