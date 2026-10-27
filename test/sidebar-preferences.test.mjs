import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createSidebarPreferences} from '../src/sidebar-preferences.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';
import {scratchBase} from './scratch.mjs';

test('shared sidebar imports desktop once, serializes edits and only appends discoveries', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'sidebar-'));
  const store = await createSidebarPreferences(root);
  assert.equal(await store.update({append: ['A', 'B']}), null);
  await store.update({initialize: true, layout: 'flat', sort: 'manual', order: ['B', 'A']});
  await store.update({initialize: true, order: ['A', 'B']});
  await Promise.all([
    store.update({sort: 'recent'}),
    store.update({append: ['A', 'C']}),
    store.update({layout: 'grouped'})
  ]);
  assert.deepEqual(store.value, {layout: 'grouped', sort: 'recent', order: ['B', 'A', 'C']});
  assert.deepEqual((await createSidebarPreferences(root)).value, store.value);
  assert.equal(remoteRouteAllowed('POST', '/api/sidebar/preferences'), true);
  for (const bad of [{order: 'bad'}, {order: [null]}, {sort: 'bad'}, {layout: null}, []])
    await assert.rejects(store.update(bad));
  assert.deepEqual((await createSidebarPreferences(root)).value, store.value);
});

test('unreadable sidebar record does not stop startup or overwrite the original', async () => {
  for (const original of ['{broken', '{"sort":"manual"}', '{"layout":"flat","sort":"manual","order":[5]}']) {
    const root = await mkdtemp(path.join(scratchBase, 'sidebar-bad-'));
    const file = path.join(root, '.runtime', 'sidebar-preferences.json');
    await mkdir(path.dirname(file));
    await writeFile(file, original);
    const store = await createSidebarPreferences(root);
    assert.match(store.error, /原檔已保留/);
    assert.equal(store.value, null);
    await assert.rejects(store.update({initialize: true, order: []}), /原檔已保留/);
    assert.equal(await readFile(file, 'utf8'), original);
  }
});
