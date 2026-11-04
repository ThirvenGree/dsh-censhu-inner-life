import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const page of ['settings.html', 'display.html', 'overview.html']) {
  test(`${page}: style updates preserve unique live controls and executable scripts`, () => {
    const html = fs.readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'duplicate ids can update the wrong panel');
    assert.doesNotMatch(html, /^(<<<<<<<|=======|>>>>>>>)/m);
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.ok(scripts.length);
    for (const script of scripts) new vm.Script(script, {filename: page});
    const required = page === 'settings.html'
      ? ['restart', 'roleBudget', 'interestStatus', 'interestItems', 'interestHistory', 'save', 'consider', 'retry']
      : page === 'display.html' ? ['refresh', 'status', 'entries', 'effects'] : ['cards', 'stamp', 'notice'];
    for (const id of required) assert.ok(ids.includes(id), `${id} is a live page control`);
    if (page === 'settings.html') {
      const literalBindings = [...scripts.join('\n').matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
      const generatedIds = [...scripts.join('\n').matchAll(/\.id='([^']+)'/g)].map(match => match[1]);
      for (const id of literalBindings) assert.ok(ids.includes(id) || generatedIds.includes(id), `${id} must have a page or generated element`);
      assert.match(scripts.join('\n'), /\$\('restart'\)\.onclick/);
      assert.match(scripts.join('\n'), /renderInterests\(x\.interests\)/);
      assert.match(scripts.join('\n'), /pic\.attachment\.attachmentId/);
    }
  });
}
