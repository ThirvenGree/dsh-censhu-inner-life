import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile=path.resolve(process.argv[2]||path.join(home,'profiles/desktop'));
const file=path.join(profile,'package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8')),life=path.join(profile,'node_modules/dsh-cen-shu-life/package.json');
if(!fs.existsSync(life)||JSON.parse(fs.readFileSync(life,'utf8')).version.localeCompare('1.18.0',undefined,{numeric:true})<0)throw Error('请先升级岑舒生活至1.18.0或以上');
execFileSync(process.execPath,[path.join(root,'scripts/install-isolation.mjs'),profile],{stdio:'inherit'});
const link=path.join(profile,'node_modules/dsh-censhu-inner-life');if(fs.existsSync(link)&&fs.realpathSync(link)!==fs.realpathSync(root))throw Error('已有独处插件指向其他目录');
fs.copyFileSync(file,file+'.before-inner-life.bak');pkg.dependencies||={};pkg.dependencies['dsh-censhu-inner-life']='link:'+root.replaceAll('\\','/');pkg.dsh||={};pkg.dsh.profile||={};pkg.dsh.profile.bundles||=[];if(!pkg.dsh.profile.bundles.includes('dsh-censhu-inner-life'))pkg.dsh.profile.bundles.push('dsh-censhu-inner-life');fs.writeFileSync(file,JSON.stringify(pkg,null,2));if(!fs.existsSync(link))fs.symlinkSync(root,link,process.platform==='win32'?'junction':'dir');console.log('已安装岑舒独处生活。重启DSH后在设置页查看。');
