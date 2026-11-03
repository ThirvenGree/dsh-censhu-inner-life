import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MethodMemory } from '../lib/method-memory.js';
import { role, worker, episode, proposal, id } from './method-fixture.mjs';

function setup() {
  const calls = [],
    files = new Map([
      ['../characters/censhu/integration.json', { sessionId: role }],
      ['display-session.json', { sessionId: worker }],
    ]);
  let clock = 90;
  const state = {
    episode: structuredClone(episode),
    report: 'supported',
    configured: true,
    review: 'approve',
    propose: proposal,
  };
  const core = {
    now: () => clock,
    config: { enabled: true, memoryEnabled: true },
    record: {},
    statusSnapshot: { sessionIds: [role] },
    read: (n, d) => structuredClone(files.get(n) ?? d),
    write: (n, v) => files.set(n, structuredClone(v)),
    life: {
      independentReviewStatus: () => ({ configured: state.configured }),
      async judge(s, _schema, input, { feature }) {
        calls.push({ feature, input });
        if (feature === 'inner-method-propose') return state.propose;
        if (feature === 'inner-method-review')
          return { decision: state.review, reason: '核对实际资料', verifiedEvidenceIds: ['step:1'] };
        if (feature === 'inner-method-recall') return { ids: [id] };
        assert.fail('未知模型路径 ' + feature);
      },
    },
  };
  const dependencies = {
    browser: () => ({
      list: async (p) => (state.episode && p === state.episode.parentId ? [state.episode] : []),
      read: async (p, c) =>
        state.episode && state.episode.parentId === p && state.episode.childId === c ? state.episode : null,
    }),
    replay: () => ({
      async screenMethod(payload) {
        calls.push({ feature: 'screen', input: payload });
        return {
          candidateId: payload.candidateId,
          status: state.report,
          error: state.report === 'unavailable' ? 'HTTP 402 Insufficient Balance' : undefined,
          digest: 'sample-digest',
          model: 'test-replay',
          probes: payload.probes.map((p) => ({ id: p.id, classification: 'verified' })),
        };
      },
    }),
  };
  return {
    model: new MethodMemory(core, dependencies),
    calls,
    core,
    state,
    files,
    dependencies,
    advance: (n) => {
      clock += n;
    },
  };
}

test('同一来源版本仅审核一次，三路筛选后独立核对；按目标召回后仍能放下或犹豫', async () => {
  const h = setup();
  await h.model.tick();
  assert.deepEqual(
    h.calls.map((x) => x.feature),
    ['inner-method-propose', 'screen', 'inner-method-review'],
  );
  const p = h.calls[1].input;
  assert.deepEqual(
    p.probes.map((x) => [x.expected, x.requiredIds]),
    [
      ['use', ['step:1']],
      ['avoid', ['step:2']],
    ],
  );
  assert.equal(h.model.view().approved, 1);
  const m = new MethodMemory(h.core, h.dependencies);
  h.advance(100000);
  await m.tick();
  assert.equal(h.calls.length, 3);
  const [row] = await m.recall(role, '新的表单提交后等待回执');
  assert.equal(row.id, id);
  for (const choice of ['skip', 'uncertain', 'use'])
    assert.equal((await m.decide(role, 'isolated-run', row.id, row.version, choice, '当前选择')).decision, choice);
  await m.decide(role, 'isolated-run', row.id, row.version, 'use', '当前选择');
  assert.equal(m.data.decisions.length, 3);
  assert.deepEqual(
    [...h.files.keys()].filter((n) => !n.includes('integration') && !n.includes('display-session')),
    ['method-memory.json'],
  );
  await assert.rejects(() => m.decide(role, 'old-run', row.id, row.version, 'use', '不可操作', () => false));
  h.state.episode.version = 'edited';
  assert.deepEqual(await m.recall(role, '复查'), []);
  assert.equal(m.view().approved, 0);
  assert.equal(m.data.jobs[id].phase, 'source-unavailable');
  assert.equal(m.data.jobs[id].candidate, undefined);
  assert.equal(h.calls.filter((x) => x.feature === 'inner-method-recall').length, 1);
  await assert.rejects(() => m.decide(role, 'run', row.id, row.version, 'use', '旧来源不能用'));
  h.state.episode = null;
  assert.deepEqual(await m.recall(role, '已删除'), []);
});
test('未通过正反回放、审核不确定和缺少独立审核配置均停止于批准之前', async () => {
  for (const [report, review, configured, phase, features] of [
    ['unconfirmed', 'approve', true, 'unconfirmed', ['inner-method-propose', 'screen']],
    ['supported', 'uncertain', true, 'uncertain', ['inner-method-propose', 'screen', 'inner-method-review']],
    ['supported', 'approve', false, 'propose', []],
  ]) {
    const h = setup();
    Object.assign(h.state, { report, review, configured });
    await h.model.tick();
    assert.equal(h.model.view().approved, 0);
    assert.equal(h.model.data.jobs[id].phase, phase);
    assert.deepEqual(
      h.calls.map((c) => c.feature),
      features,
    );
    assert.deepEqual(await h.model.recall(role, '继续'), []);
  }
});
test('临时失去回放服务时可从已保存阶段重试，忽略外部父会话、测试会话及无原文引用', async () => {
  const h = setup();
  const replay = h.dependencies.replay;
  h.dependencies.replay = () => null;
  await h.model.tick();
  assert.equal(h.model.view().approved, 0);
  assert.equal(h.calls.length, 0);
  h.dependencies.replay = replay;
  h.advance(16 * 60e3);
  await h.model.tick();
  assert.equal(h.model.view().approved, 1);
  h.core.statusSnapshot.sessionIds = ['test'];
  assert.equal(h.model.view().approved, 0);
  await assert.rejects(() => h.model.recall(role, '测试'));
  await assert.rejects(() => h.model.decide(role, 'test', id, episode.version, 'use', '尝试'));
  for (const mutate of [
    (s) => {
      s.episode.parentId = 'unrelated-test';
    },
    (s) => {
      s.propose = { ...proposal, evidence: [{ id: 'step:1', quote: '虚构的回执' }] };
    },
  ]) {
    const other = setup();
    mutate(other.state);
    await other.model.tick();
    assert.equal(other.model.view().approved, 0);
    assert.ok(!other.calls.some((c) => c.feature === 'screen'));
  }
});
test('长经历保留所引原文及真实反例，送去回放最多八条', async () => {
  const h = setup();
  h.state.episode.evidence.push(
    ...Array.from({ length: 30 }, (_, i) => ({
      ...episode.evidence[0],
      id: 'step:' + (i + 3),
      at: 200 + i,
      text: '其他回执 ' + i,
    })),
  );
  await h.model.tick();
  const records = h.calls.find((x) => x.feature === 'screen').input.probes[0].records;
  assert.equal(records.length, 8);
  assert.ok(records.some((r) => r.id === 'step:2'));
  assert.equal(h.model.view().approved, 1);
});
test('独处日记只接受本角色已审核的日记及本任务可重读的真实产物', (t) => {
  const h = setup(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'method-artifact-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'artifact.txt');
  fs.writeFileSync(file, 'template');
  const hash = createHash('sha256').update('template').digest('hex');
  h.core.record = {
    entries: [{ id: 'diary', reviewedAt: 100 }],
    agencyRequests: [
      {
        id: 'diary',
        status: 'reviewed',
        sourceId: role,
        workerId: worker,
        thread: 'x',
        reflection: '保存模板并重新核对',
        at: 100,
      },
    ],
  };
  h.files.set('action-ledger.json', {
    actions: {
      action: {
        actionId: 'a1',
        runId: 'agency:x',
        expectedFile: { path: file, bytes: 8, hash },
        name: 'write_file',
        verification: 'file-content-matched',
        state: 'completed',
        finishedAt: 95,
      },
    },
  });
  assert.match(h.model.diaryEpisode('diary').evidence[0].text, /产物已核实/);
  fs.writeFileSync(file, 'changed!');
  assert.equal(h.model.diaryEpisode('diary'), null);
  h.core.record.agencyRequests[0].workerId = 'test';
  assert.equal(h.model.diaryEpisode('diary'), null);
});

test('模型执行失败会退避并从回放续跑，不会误报反例未通过', async () => {
  const h = setup();
  h.state.report = 'unavailable';
  await h.model.tick();
  const status = h.model.view();
  assert.deepEqual(status.services, { browser: true, replay: true });
  assert.match(status.items[0].reason, /402/);
  assert.ok(status.items[0].retryAt > h.core.now());
  assert.equal(status.items[0].phase, 'replay');
  h.advance(2 * 60e3);
  await h.model.tick();
  assert.deepEqual(
    h.calls.map((c) => c.feature),
    ['inner-method-propose', 'screen'],
  );
  h.state.report = 'supported';
  h.advance(15 * 60e3);
  await h.model.tick();
  assert.deepEqual(
    h.calls.map((c) => c.feature),
    ['inner-method-propose', 'screen', 'screen', 'inner-method-review'],
  );
  assert.equal(h.model.view().approved, 1);
});
for (const outcome of ['resolve', 'reject']) {
  test('独立审核返回后卸载，旧证据读取 ' + outcome + ' 不得批准、退避或覆盖重载后的审核', async () => {
    const h = setup(), entered = Promise.withResolvers(), read = Promise.withResolvers();
    const browser = h.dependencies.browser(), write = h.core.write;
    let paused = false, staleWrites = 0;
    h.dependencies.browser = () => ({
      ...browser,
      async read(parent, child) {
        if (!paused && h.calls.some((c) => c.feature === 'inner-method-review')) {
          paused = true;
          entered.resolve();
          return read.promise;
        }
        return browser.read(parent, child);
      },
    });
    h.core.write = (name, value) => {
      if (h.core.disposed) staleWrites++;
      write(name, value);
    };

    const oldTick = h.model.tick();
    await entered.promise;
    const checkpoint = structuredClone(h.model.data.jobs[id]);
    assert.equal(checkpoint.phase, 'review');
    h.core.disposed = true;
    h.state.review = 'skip';
    const replacement = new MethodMemory({ ...h.core, disposed: false, write }, h.dependencies);
    await replacement.tick();
    const saved = h.files.get('method-memory.json');
    assert.equal(saved.jobs[id].phase, 'skip');

    if (outcome === 'resolve') read.resolve(h.state.episode);
    else read.reject(Error('HTTP 402 simulated late browser failure'));
    await oldTick;
    assert.equal(staleWrites, 0);
    assert.deepEqual(h.model.data.jobs[id], checkpoint);
    assert.equal(h.model.data.providerRetryAt, undefined);
    assert.deepEqual(h.files.get('method-memory.json'), saved);
  });
}

test('插件在发现来源期间卸载，迟到的清单不会建任务或请求审核', async () => {
  const h = setup(), entered = Promise.withResolvers(), list = Promise.withResolvers();
  let lists = 0, writes = 0;
  h.dependencies.browser = () => ({
    async list() {
      lists++;
      entered.resolve();
      return list.promise;
    },
  });
  const tick = h.model.tick();
  await entered.promise;
  h.core.disposed = true;
  h.core.write = () => { writes++; };
  list.resolve([h.state.episode]);
  await tick;
  assert.equal(lists, 1);
  assert.equal(writes, 0);
  assert.deepEqual(h.model.data.jobs, {});
  assert.deepEqual(h.calls, []);
});

test('采用方法时原证据仍在读取，插件卸载后不给当前回合保存选择', async () => {
  const h = setup();
  await h.model.tick();
  const entered = Promise.withResolvers(), read = Promise.withResolvers();
  const { version } = h.model.data.jobs[id];
  h.dependencies.browser = () => ({
    async read() { entered.resolve(); return read.promise; },
  });
  const choose = h.model.decide(role, 'outstanding-run', id, version, 'use', '适合本次任务');
  await entered.promise;
  h.core.disposed = true;
  read.resolve(h.state.episode);
  await assert.rejects(choose, /无法核对/);
  assert.deepEqual(h.model.data.decisions, []);
  assert.deepEqual(h.files.get('method-memory.json').decisions, []);
});
