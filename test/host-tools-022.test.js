// 2026-11-07: DSH 0.2.2 batch-shaped tool execution; read_image from the private archive must work on both hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeHostTool} from '../lib/host-tools.js';

test('old host keeps nested call fields (parent, rootCallId)', async () => {
  let got; const tools = {execute: async i => { got = i; return {content: [], isError: false}; }};
  const input = {name: 'read_image', arguments: {file_path: 'a.png'}, agent: {}, callId: 'c', rootCallId: 'r', parent: 'tok'};
  await executeHostTool(tools, input);
  assert.equal(got, input);
});

test('batch host receives read_image as one tool-call', async () => {
  let got; const tools = {setExecutor() {}, execute: async i => { got = i; return {results: [{callId: 'c', result: {content: [{type: 'image'}], isError: false}}]}; }};
  const r = await executeHostTool(tools, {name: 'read_image', arguments: {file_path: 'a.png'}, agent: {}, callId: 'c', parent: 'tok'});
  assert.equal(r.isError, false);
  assert.deepEqual(got.calls, [{type: 'tool-call', id: 'c', name: 'read_image', arguments: '{"file_path":"a.png"}'}]);
});
