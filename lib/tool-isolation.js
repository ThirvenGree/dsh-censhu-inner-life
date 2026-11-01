import {isPrivateSession} from './isolation.js';

export const PRIVATE_TOOL_DENIAL = '独处会话禁止执行工具。请只输出待审核的日记、感受和打算；记忆及其他变更由审核流程处理。';

// Keep protection for registered private identities beyond a single turn: a
// timeout, resumed session or late dispatch must not reopen tool access.
export function installToolIsolation(ctx, allowed = () => false) {
  if (typeof ctx.tools?.guard !== 'function')
    throw Error('DSH缺少tools.guard，无法保证独处工具隔离；停止加载独处插件');
  const privateExecution = exec => isPrivateSession(exec?.agent) && !allowed();
  const offGate = ctx.on('tools/pre-execute', (exec, next) =>
    privateExecution(exec) ? {kind:'deny', reason:PRIVATE_TOOL_DENIAL} : next(),
  {prepend:true});
  let offGuard;
  try {
    offGuard = ctx.tools.guard(exec => privateExecution(exec) ? PRIVATE_TOOL_DENIAL : undefined);
  } catch (error) {
    offGate();
    throw error;
  }
  return () => { offGuard(); offGate(); };
}
