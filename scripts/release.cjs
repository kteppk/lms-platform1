const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),file=path.join(root,'release.json');
const release=JSON.parse(fs.readFileSync(file,'utf8'));
const part=process.argv[2];
if(part){
  if(!['patch','minor','major'].includes(part))throw Error('Use: npm run release -- patch|minor|major');
  const v=release.version.split('.').map(Number),i={major:0,minor:1,patch:2}[part];v[i]++;for(let n=i+1;n<3;n++)v[n]=0;release.version=v.join('.');
  fs.writeFileSync(file,JSON.stringify(release,null,2)+'\n');
}
if(!/^\d+\.\d+\.\d+$/.test(release.version))throw Error('Invalid release version');
const pkgFile=path.join(root,'package.json'),pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));pkg.version=release.version;
fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');
const lockFile=path.join(root,'package-lock.json');
if(fs.existsSync(lockFile)){const lock=JSON.parse(fs.readFileSync(lockFile,'utf8'));lock.version=release.version;lock.packages[''].version=release.version;fs.writeFileSync(lockFile,JSON.stringify(lock,null,2)+'\n');}
fs.writeFileSync(path.join(root,'release.js'),'// Generated from release.json by scripts/release.cjs\nconst SiteRelease = Object.freeze('+JSON.stringify(release)+');\n');
for(const html of ['index.html','student.html','teacher.html','admin.html','offline.html']){
  const p=path.join(root,html);let source=fs.readFileSync(p,'utf8').replace(/(data-site-version>)[^<]*/g,'$1Версия '+release.version);
  source=source.replace(/(src|href)="([^"?]+\.(?:js|css))(?:\?[^\"]*)?"/g,(all,attribute,url)=>/^https?:/.test(url)?all:`${attribute}="${url}?v=${release.version}"`);
  fs.writeFileSync(p,source);
}
const assets=new Set(['index.html','student.html','teacher.html','admin.html','offline.html','name-fields.mjs?v=identity1','supabase/functions/_shared/name-rules.mjs?v=identity1']);
for(const html of ['index.html','student.html','teacher.html','admin.html','offline.html'])for(const match of fs.readFileSync(path.join(root,html),'utf8').matchAll(/(?:src|href)="([^\"]+)"/g))if(!/^https?:/.test(match[1])&&/\.(js|css|mjs)(\?|$)/.test(match[1]))assets.add(match[1]);
fs.writeFileSync(path.join(root,'sw-manifest.js'),'// Generated static shell only.\nconst OFFLINE_ASSETS='+JSON.stringify([...assets])+';\n');
fs.writeFileSync(path.join(root,'sw.js'),fs.readFileSync(path.join(root,'scripts/service-worker.template.js'),'utf8').replaceAll('__VERSION__',JSON.stringify(release.version)));
console.log('Release '+release.version+' prepared. Update release.json title/notes, then commit and push.');
