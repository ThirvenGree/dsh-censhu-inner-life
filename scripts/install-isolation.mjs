import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile=path.resolve(process.argv[2]||path.join(home,'profiles/desktop'));
const url=pathToFileURL(path.join(root,'lib/isolation.js')).href;
const specs=[
  ["dsh-memory-evolve/lib/index.js",[["async execute(args, exec) {\n      const target = args.target","async execute(args, exec) {\n      if(isProbeWorkspace(exec?.agent?.session?.header?.cwd || exec?.agent?.session?.cwd)) return {ok:false,message:'测试工作区不使用正式记忆工具'};\n      const target = args.target"]]],
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
 {for(const [from,to] of replacements){if(source.includes(to))continue;if(!source.includes(from))throw Error('隔离适配不兼容，未写入：'+rel+' / '+from.slice(0,70));source=source.replace(from,to);}if(!source.includes('// censhu-private-session-v1'))source="// censhu-private-session-v1\nimport {isPrivateSession,isInternalMessage,isProbeWorkspace} from "+JSON.stringify(url)+";\n"+source;}
 // Filter historical synthetic user messages in Engram as well as isolating worker sessions.
 if(rel.startsWith('@kenz1117/')&&!source.includes('|| isInternalMessage(message)'))source=source.replaceAll('message.source?.kind.startsWith("plugin")','(message.source?.kind.startsWith("plugin") || isInternalMessage(message))');
 // Remove the former whole-session QQ guards without touching private-session isolation.
 if(rel==='dsh-mnemon/lib/index.js'||rel==='dsh-memory-evolve/lib/advisor/index.js'){
   for(const id of ['agent','sessionId'])source=source.replaceAll('if (isPrivateSession('+id+')) return;\n    if (requiresReviewedCapture('+id+')) return;','if (isPrivateSession('+id+')) return;');
 }
 if(rel==='dsh-mnemon/lib/index.js'){
   const change=(old,next)=>{if(source.includes(next))return;if(source.split(old).length!==2)throw Error('mnemon 接口不匹配：'+old);source=source.replace(old,()=>next);};
   change('if (this.config.writeEnabled && this.config.writebackMode === "guided") this.recordTurnMessages','if (!requiresReviewedCapture(this.agent) && this.config.writeEnabled && this.config.writebackMode === "guided") this.recordTurnMessages');
   change('idleReviewAllowed() {','idleReviewAllowed() {\n        if(requiresReviewedCapture(this.agent))return false;');
   change('scheduleIdleReview(turn) {','scheduleIdleReview(turn) {\n        if(requiresReviewedCapture(this.agent)){this.cancelIdleReview(true);return;}');
   change('guidedReminder(this.config, this.memoryTurn','guidedReminder(requiresReviewedCapture(this.agent)?{...this.config,writeEnabled:false}:this.config, this.memoryTurn');
   const api=pathToFileURL(path.join(profile,'node_modules/dsh-cen-shu-life/lib/reviewed-write.js')).href;
   if(!source.includes('import {isAuditedWrite}'))source='import {isAuditedWrite} from '+JSON.stringify(api)+';\n'+source;
   change('composableTurn(exec);\n\t\t\tconst request = {\n\t\t\t\taction: args.action','if(!isAuditedWrite(exec))composableTurn(exec);\n\t\t\tconst request = {\n\t\t\t\taction: args.action');
   const marker='name: "mnemon_runtime_memory",';const pos=source.indexOf(marker),anchor='ctx.tools.register(definition({';const insert=source.lastIndexOf(anchor,pos);
   if(!source.includes('name:"censhu_mnemon_entries"')){
     if(pos<0||insert<0||pos-insert>100)throw Error('mnemon 快照工具接口变化');
     source=source.slice(0,insert)+`ctx.tools.register(definition({name:"censhu_mnemon_entries",description:"按原文片段查看 Mnemon 运行时记忆。",parameters:{type:"object",required:["target","match"],properties:{target:{type:"string",enum:["user","memory"]},match:{type:"string"}}},output:{schema:JSON_OBJECT_OUTPUT,render:(_a,v)=>text(v)},async execute(args,exec){if(!args.match?.trim())throw Error("需要原文片段");const graph=requireSource(exec,"runtime","read"),parent=requireAgent(exec),lease=graph.memoryComposition.acquire();try{const snap=await graph.source("runtime",agentScope(parent,graph.config)).forGeneration(lease.generation).read("snapshot",null,exec.signal);const rows=snap.entries.filter(r=>r.target===args.target&&r.content.includes(args.match));return {ok:true,total:rows.length,entries:rows.slice(0,20).map(r=>r.content)};}finally{lease.release();}}}));\n\t`+source.slice(insert);
   }
 }
 if(rel==='@kenz1117/dsh-engram/lib/index.js'&&!source.includes('name:"censhu_engram_record"')){
   const anchor='\t\tforget,\n\t\tdefineTool({\n\t\t\tname: "engram_report"';
   if(source.split(anchor).length!==2)throw Error('Engram 单条读取接口不兼容');
   source=source.replace(anchor,()=>anchor.replace('forget,',`forget,
        defineTool({name:"censhu_engram_record",description:"Read one exact Engram record in user or project scope",parameters:{id:{type:"string",required:true},scope:{type:"string",enum:["user","project"],required:true}},output:{schema:{type:"object",properties:{found:{type:"boolean"},id:{type:"string"},content:{type:"string"},status:{type:"string"}}},render:(_a,v)=>[{type:"text",text:JSON.stringify(v)}]},async execute(args){const row=await (await deps.openStore(scopeOf(args.scope,"project"))).get(args.id);return row?{found:true,id:row.id,content:row.content,status:row.status}:{found:false};}}),`));
 }
 const capturePoints={
   '@kenz1117/dsh-engram/lib/index.js':[['if (isPrivateSession(deps.sessionId)) return;', 'deps.sessionId','return;']],
   '@openviking/dsh-memory-plugin/index.mjs':[['if (skipMemory(session)) return;','session','return;']],
   '@furongjun1999/dsh-memory/lib/hooks.js':[['if (isPrivateSession(session)) return true;','session','return true;']],
   'dsh-mnemon/lib/index.js':[],
   'dsh-memory-evolve/lib/advisor/index.js':[['if (isPrivateSession(session)) return;','session','return;']]
 };
 if(capturePoints[rel]){
   if(!source.includes('import {requiresReviewedCapture}'))source='import {requiresReviewedCapture} from '+JSON.stringify(url)+';\n'+source;
   for(const [anchor,value,exit] of capturePoints[rel]){
     const guarded=anchor+'\n    if (requiresReviewedCapture('+value+')) '+exit;
     if(!source.includes(anchor))throw Error('自动记忆采集入口未找到：'+rel);
     source=source.split(guarded).join(anchor).split(anchor).join(guarded);
   }
 }
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
