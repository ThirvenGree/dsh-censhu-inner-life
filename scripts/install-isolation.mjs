import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile=path.resolve(process.argv[2]||path.join(home,'profiles/desktop'));
const url=pathToFileURL(path.join(root,'lib/isolation.js')).href;
const specs=[
  [
    "@openviking/dsh-memory-plugin/index.mjs",
    [
      [
        "const skipMemory = session => (",
        "const skipMemory = session => (isPrivateSession(session) || "
      ]
    ]
  ],
  [
    "@furongjun1999/dsh-memory/lib/hooks.js",
    [
      [
        "function isSubagentSession(session) {",
        "function isSubagentSession(session) {\n    if (isPrivateSession(session)) return true;"
      ]
    ]
  ],
  [
    "dsh-memory-evolve/lib/advisor/index.js",
    [
      [
        "ctx.on('session/event', (session, event) => {",
        "ctx.on('session/event', (session, event) => {\n    if (isPrivateSession(session)) return;"
      ],
      [
        "ctx.on('agent/created', ({ agent }) => {",
        "ctx.on('agent/created', ({ agent }) => {\n    if (isPrivateSession(agent)) return;"
      ],
      [
        "const ensureRuntime = (sessionId) => {",
        "const ensureRuntime = (sessionId) => {\n    if (isPrivateSession(sessionId)) return;"
      ]
    ]
  ],
  [
    "dsh-mnemon/lib/index.js",
    [
      [
        "install(agent, source) {",
        "install(agent, source) {\n        if (isPrivateSession(agent)) return;"
      ]
    ]
  ],
  [
    "@kenz1117/dsh-engram/lib/index.js",
    [
      [
        "const decision = await next();\n\tif (decision.kind === \"reject\")",
        "const decision = await next();\n\tif (isPrivateSession(agent)) return decision;\n\tif (decision.kind === \"reject\")"
      ],
      [
        "if (resolved.ingest !== \"off\") ctx.on(\"session/disposed\", (session) => {",
        "if (resolved.ingest !== \"off\") ctx.on(\"session/disposed\", (session) => {\n        if (isPrivateSession(session)) return;"
      ],
      [
        "async function ingestPreviousTurn(deps) {",
        "async function ingestPreviousTurn(deps) {\n    if (isPrivateSession(deps.sessionId)) return;"
      ],
      [
        "async function ingestFinalTurn(deps) {",
        "async function ingestFinalTurn(deps) {\n    if (isPrivateSession(deps.sessionId)) return;"
      ]
    ]
  ],
  [
    "dsh-feiyu-mood/lib/index.js",
    [
      [
        "function mountFor(agent, sid, slot) {",
        "function mountFor(agent, sid, slot) {\n    if (isPrivateSession(agent)) return () => {};"
      ],
      [
        "const p = e.payload !== undefined ? e.payload : e.data",
        "const p = e.payload !== undefined ? e.payload : e.data\n      if (isInternalMessage(p)) return null"
      ],
      [
        "const msg = payload && payload.message ? payload.message : payload",
        "const msg = payload && payload.message ? payload.message : payload\n        if (isInternalMessage(msg)) { lastText = ''; lastSrc = msg.source.kind; return }"
      ],
      [
        "if (!stillBound()) return\n        // 以会话事件",
        "if (!stillBound() || isInternalMessage({source:{kind:lastSrc}})) return\n        // 以会话事件"
      ]
    ]
  ]
];
const manifest={version:1,protocol:'censhu-private-session-v1',at:Date.now(),files:[]};const plans=[];
for(const [rel,replacements] of specs){const file=path.join(profile,'node_modules',rel);if(!fs.existsSync(file))continue;let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 {for(const [from,to] of replacements){if(source.includes(to))continue;if(!source.includes(from))throw Error('隔离适配不兼容，未写入：'+rel+' / '+from.slice(0,70));source=source.replace(from,to);}if(!source.includes('// censhu-private-session-v1'))source="// censhu-private-session-v1\nimport {isPrivateSession,isInternalMessage} from "+JSON.stringify(url)+";\n"+source;}
 // Filter historical synthetic user messages in Engram as well as isolating worker sessions.
 if(rel.startsWith('@kenz1117/')&&!source.includes('|| isInternalMessage(message)'))source=source.replaceAll('message.source?.kind.startsWith("plugin")','(message.source?.kind.startsWith("plugin") || isInternalMessage(message))');
 plans.push({file,source});manifest.files.push({file,hash:createHash('sha256').update(source).digest('hex')});
}
const coordinator=path.join(profile,'node_modules/dsh-cen-shu-life/lib/adapter-coordination.js');
const {synchronizeMoodAdapters}=await import(pathToFileURL(coordinator).href);
for(const {file,source} of plans)if(file.replaceAll('\\','/').includes('/dsh-feiyu-mood/'))synchronizeMoodAdapters(home,file,source,{validateOnly:true});
// Validate all adapters before mutating any installed plugin.
for(const {file,source} of plans){const check=file+'.isolation-check.mjs';try{fs.writeFileSync(check,source);execFileSync(process.execPath,['--check',check],{stdio:'pipe'});}finally{if(fs.existsSync(check))fs.unlinkSync(check);}}
for(const {file,source} of plans){if(!fs.existsSync(file+'.before-inner-isolation.bak'))fs.copyFileSync(file,file+'.before-inner-isolation.bak');fs.writeFileSync(file,source);}
const target=path.join(home,'censhu-inner-life');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'isolation-adapters.json'),JSON.stringify(manifest,null,2));for(const {file,source} of plans)if(file.replaceAll('\\','/').includes('/dsh-feiyu-mood/')){const coordinated=synchronizeMoodAdapters(home,file,source);for(const item of coordinated.skipped)console.warn('未更新对方登记：'+item.reason+'；本次隔离安装继续完成');}
console.log('独处隔离适配完成：'+plans.length+' 个已安装插件。');
