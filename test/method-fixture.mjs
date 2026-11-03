import { createHash } from 'node:crypto';
export const role = 'session-method-fixture-role',
  worker = 'session-method-fixture-life';
const version = 'fixture-source-1';
export const episode = {
  goal: '在测试表单区分请求已提交和尚未发出的情况，避免把同一份表单交两次。',
  parentId: worker,
  childId: 'fixture-form',
  version,
  at: 100,
  evidence: [
    {
      id: 'step:1',
      kind: 'receipt',
      tool: 'bsk_inspect.observe',
      text: '第一次点击提交后，界面显示“请求已提交，等待回执”。随后订单详情显示“回执 R17，状态已受理”。没有再次提交。',
      at: 90,
      isError: false,
    },
    {
      id: 'step:2',
      kind: 'receipt',
      tool: 'bsk_inspect.observe',
      text: '另一次表单校验显示“必填项为空，请求未发出”；补填并首次提交后才出现受理回执 R18。',
      at: 95,
      isError: false,
    },
  ],
};
export const proposal = {
  decision: 'propose',
  reason: '两种页面状态有不同处理。',
  goal: '在表单提交状态不明时避免重复提交',
  when: '点击后页面已明确请求发出，但还没有受理回执',
  method: '先到详情核对已有请求和回执，再决定是否需要处理；等待时不重复提交',
  avoidWhen: '页面明确说明校验失败且请求未发出时，应先修正表单',
  verify: '在详情核对同一请求的受理状态和回执编号',
  positiveQuestion:
    '此前首次点击后出现“请求已提交，等待回执”的那一次，假设现在又遇到相同状态，此时如何考虑该方法？',
  negativeQuestion: '此前出现“必填项为空，请求未发出”的那一次，假设这次也明确没有发出请求，此时如何考虑该方法？',
  evidence: [{ id: 'step:1', quote: '回执 R17，状态已受理' }],
  counterEvidence: [{ id: 'step:2', quote: '必填项为空，请求未发出' }],
};
export const id = createHash('sha256')
  .update(JSON.stringify([role, worker, 'browser', episode.childId]))
  .digest('hex')
  .slice(0, 40);
