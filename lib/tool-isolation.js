import {isPrivateSession,isTestSession} from './isolation.js';

const ownTools=new Set(['censhu_agency_activity','censhu_agency_arrange','censhu_agency_contact','censhu_agency_diary','censhu_agency_method','censhu_agency_note','censhu_agency_context_page','censhu_agency_find_event','censhu_agency_event_history','censhu_question_recall','censhu_read_memory','censhu_correct_memory']);
const contextReads=new Set(['censhu_context_recall','censhu_question_recall']);
export const isContextRead=exec=>contextReads.has(exec?.name);

export const PRIVATE_TOOL_DENIAL = '独处会话禁止执行工具。请只输出待审核的日记、感受和打算；记忆及其他变更由审核流程处理。';

// 2026-11-07: test (probe) sessions may read memory and role state, but never write it.
// Platform and browser tools stay usable so outbound flows can still be tested.
export const TEST_WRITE_DENIAL = '测试会话只读：可以查记忆和角色状态，不能写入、更正或删除记忆，也不能改动生活、心情、性格等插件状态。';
const roleStateTool=/^(?:censhu_|engram_|mnemon_|mdcg_|lingshu_mdcg_|mcp__openviking__|mcp__snowluma__qq_memory_|memory(?:_|$))|^(?:douyin_remember|douyin_recall|learn_meme|meme_update|mcp__snowluma__qq_life_inspiration)$/;
const testReads=new Set([
  'censhu_agency_context_page','censhu_agency_event_history','censhu_agency_find_event','censhu_context_recall','censhu_engram_record',
  'censhu_knowledge_recall','censhu_life_context','censhu_current_state','censhu_help','censhu_mnemon_entries','censhu_question_recall','censhu_read_memory','censhu_tool_catalog','censhu_tool_result_read',
  'douyin_recall',
  'engram_assess','engram_audit_forgotten','engram_episode_timeline','engram_examine','engram_language_guide','engram_neighbors','engram_review','engram_review_queue','engram_search','engram_stats','engram_timeline','engram_tour',
  'mcp__openviking__find','mcp__openviking__glob','mcp__openviking__grep','mcp__openviking__health','mcp__openviking__list','mcp__openviking__read','mcp__openviking__search','mcp__openviking__tree',
  'mcp__openviking__download','mcp__openviking__get_acl','mcp__openviking__list_groups','mcp__openviking__list_users','mcp__openviking__list_watches',
  'mcp__snowluma__qq_memory_query',
  // lingshu_mdcg_* are deprecated aliases and are matched by their mdcg_* name.
  'mdcg_recall','mdcg_search','mdcg_get','mdcg_health','mdcg_review_list','mdcg_review_records','mdcg_service_info','mdcg_watermarks','mdcg_whoami',
  'mnemon_document_search','mnemon_memory_bodies','mnemon_recall','mnemon_related','mnemon_status',
  'memory_evolve_search_local_files',
]);
// Tools that both read and write: only these actions are reads.
const testReadActions={memory:['list','expand'],engram_profile_edit:['view'],censhu_personality:['read'],censhu_self_develop:['read'],censhu_thoughts:['read'],censhu_inner_life:['read',undefined],censhu_agency_method:['recall'],censhu_private_archive:['list','search','read'],memory_review_status:['check']};
export function testSessionWrite(exec){
  const name=String(exec?.name||'').replace(/^lingshu_(?=mdcg_)/,'');
  if(!name||!isTestSession(exec?.agent)||!roleStateTool.test(name))return false;
  const args=exec.arguments&&typeof exec.arguments==='object'?exec.arguments:{};
  if(Object.hasOwn(testReadActions,name))return !testReadActions[name].includes(args.action);
  if(name==='engram_facts')return Array.isArray(args.facts)&&args.facts.length>0;
  return !testReads.has(name);
}

// Keep protection for registered private identities beyond a single turn: a
// timeout, resumed session or late dispatch must not reopen tool access.
export function installToolIsolation(ctx, allowed = () => false, lifeSession = () => null) {
  if (typeof ctx.tools?.guard !== 'function')
    throw Error('DSH缺少tools.guard，无法保证独处工具隔离；停止加载独处插件');
  const privateExecution = exec => {
    if(!isPrivateSession(exec?.agent)||allowed()||isContextRead(exec))return false;
    const id=exec.agent?.session?.id||exec.agent?.id;
    return !(id&&id===lifeSession()&&ownTools.has(exec.name));
  };
  // The test-session write ban applies even when autonomous tools are allowed.
  const denial = exec => testSessionWrite(exec) ? TEST_WRITE_DENIAL : privateExecution(exec) ? PRIVATE_TOOL_DENIAL : undefined;
  const offGate = ctx.on('tools/pre-execute', (exec, next) => {
    const reason=denial(exec);
    return reason ? {kind:'deny', reason} : next();
  }, {prepend:true});
  let offGuard;
  try {
    offGuard = ctx.tools.guard(denial);
  } catch (error) {
    offGate();
    throw error;
  }
  return () => { offGuard(); offGate(); };
}
