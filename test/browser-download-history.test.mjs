import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { prepareBrowserDownloadHistory } from '../src/browser-download-history.mjs';

async function makeProfile({ badSchema = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'k-browser-history-'));
  const profile = path.join(root, 'profile');
  const defaultDir = path.join(profile, 'Default');
  await mkdir(defaultDir, { recursive: true });
  const history = path.join(defaultDir, 'History');
  const db = new DatabaseSync(history);
  db.exec(badSchema ? `
    CREATE TABLE downloads (id INTEGER PRIMARY KEY, state INTEGER);
  ` : `
    CREATE TABLE downloads (id INTEGER PRIMARY KEY, state INTEGER, target_path TEXT);
    CREATE TABLE downloads_url_chains (id INTEGER, chain_index INTEGER, url TEXT);
    CREATE TABLE downloads_slices (download_id INTEGER, file_path TEXT, offset INTEGER);
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
    CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT);
    INSERT INTO urls VALUES (7, 'https://kept.example/');
    INSERT INTO visits VALUES (8, 7, 12345);
    INSERT INTO cookies VALUES ('kept.example', 'session', 'unchanged');
  `);
  db.close();
  return { root, profile, history };
}

function openDb(history) {
  return new DatabaseSync(history);
}

function rows(db, sql) {
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

test('backs up every download metadata row, including orphan children, and preserves other browser data', async (t) => {
  const fixture = await makeProfile();
  const db = openDb(fixture.history);
  db.exec(`
    INSERT INTO downloads VALUES (1, 1, 'done.bin');
    INSERT INTO downloads VALUES (2, 2, 'cancelled.bin');
    INSERT INTO downloads VALUES (3, 0, 'active.bin');
    INSERT INTO downloads VALUES (4, 3, 'interrupted.bin');
    INSERT INTO downloads_url_chains VALUES (1, 0, 'https://download.example/done');
    INSERT INTO downloads_url_chains VALUES (2, 0, 'https://download.example/cancelled');
    INSERT INTO downloads_url_chains VALUES (99, 0, 'https://download.example/orphan');
    INSERT INTO downloads_slices VALUES (1, 'done.bin', 0);
    INSERT INTO downloads_slices VALUES (2, 'cancelled.bin', 0);
    INSERT INTO downloads_slices VALUES (99, 'orphan.bin', 0);
  `);
  db.close();

  const result = await prepareBrowserDownloadHistory(fixture.profile);
  assert.deepEqual(result.archivedRows, { downloads: 4, urlChains: 3, slices: 3 });
  assert.equal(result.archivedCount, 10);
  assert.match(result.backupBatchId, /^[a-f0-9]{32}$/);

  const readback = openDb(fixture.history);
  assert.deepEqual(rows(readback, 'SELECT id, state FROM downloads ORDER BY id'), []);
  assert.deepEqual(rows(readback, 'SELECT id, url FROM downloads_url_chains ORDER BY id'), []);
  assert.deepEqual(rows(readback, 'SELECT download_id, file_path FROM downloads_slices'), []);
  assert.deepEqual(rows(readback, 'SELECT * FROM urls'), [{ id: 7, url: 'https://kept.example/' }]);
  assert.deepEqual(rows(readback, 'SELECT * FROM visits'), [{ id: 8, url: 7, visit_time: 12345 }]);
  assert.deepEqual(rows(readback, 'SELECT * FROM cookies'), [
    { host_key: 'kept.example', name: 'session', value: 'unchanged' },
  ]);

  const backupPrefix = `k_download_history_backup_${result.backupBatchId}_`;
  assert.deepEqual(rows(readback, `SELECT id, state, target_path FROM "${backupPrefix}downloads" ORDER BY id`), [
    { id: 1, state: 1, target_path: 'done.bin' },
    { id: 2, state: 2, target_path: 'cancelled.bin' },
    { id: 3, state: 0, target_path: 'active.bin' },
    { id: 4, state: 3, target_path: 'interrupted.bin' },
  ]);
  assert.deepEqual(rows(readback, `SELECT id, chain_index, url FROM "${backupPrefix}url_chains" ORDER BY id`), [
    { id: 1, chain_index: 0, url: 'https://download.example/done' },
    { id: 2, chain_index: 0, url: 'https://download.example/cancelled' },
    { id: 99, chain_index: 0, url: 'https://download.example/orphan' },
  ]);
  assert.deepEqual(rows(readback, `SELECT download_id, file_path, offset FROM "${backupPrefix}slices" ORDER BY download_id`), [
    { download_id: 1, file_path: 'done.bin', offset: 0 },
    { download_id: 2, file_path: 'cancelled.bin', offset: 0 },
    { download_id: 99, file_path: 'orphan.bin', offset: 0 },
  ]);
  readback.exec(`
    INSERT INTO downloads SELECT * FROM "${backupPrefix}downloads";
    INSERT INTO downloads_url_chains SELECT * FROM "${backupPrefix}url_chains";
    INSERT INTO downloads_slices SELECT * FROM "${backupPrefix}slices";
  `);
  assert.deepEqual(rows(readback, 'SELECT id, state, target_path FROM downloads ORDER BY id'), [
    { id: 1, state: 1, target_path: 'done.bin' },
    { id: 2, state: 2, target_path: 'cancelled.bin' },
    { id: 3, state: 0, target_path: 'active.bin' },
    { id: 4, state: 3, target_path: 'interrupted.bin' },
  ]);
  assert.deepEqual(rows(readback, 'SELECT id, chain_index, url FROM downloads_url_chains ORDER BY id'), [
    { id: 1, chain_index: 0, url: 'https://download.example/done' },
    { id: 2, chain_index: 0, url: 'https://download.example/cancelled' },
    { id: 99, chain_index: 0, url: 'https://download.example/orphan' },
  ]);
  assert.deepEqual(rows(readback, 'SELECT download_id, file_path, offset FROM downloads_slices ORDER BY download_id'), [
    { download_id: 1, file_path: 'done.bin', offset: 0 },
    { download_id: 2, file_path: 'cancelled.bin', offset: 0 },
    { download_id: 99, file_path: 'orphan.bin', offset: 0 },
  ]);
  readback.close();
});

test('a later run can back up a reused download id without overwriting the prior batch', async (t) => {
  const fixture = await makeProfile();
  let db = openDb(fixture.history);
  db.exec(`INSERT INTO downloads VALUES (4, 1, 'first.bin')`);
  db.close();
  const first = await prepareBrowserDownloadHistory(fixture.profile);

  db = openDb(fixture.history);
  db.exec(`INSERT INTO downloads VALUES (4, 1, 'second.bin')`);
  db.close();
  const second = await prepareBrowserDownloadHistory(fixture.profile);
  assert.notEqual(second.backupBatchId, first.backupBatchId);

  db = openDb(fixture.history);
  const batches = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'k_download_history_backup_%_downloads'
    ORDER BY name
  `).all();
  assert.equal(batches.length, 2);
  const firstRows = rows(db, `SELECT target_path FROM "k_download_history_backup_${first.backupBatchId}_downloads"`);
  const secondRows = rows(db, `SELECT target_path FROM "k_download_history_backup_${second.backupBatchId}_downloads"`);
  assert.deepEqual(firstRows, [{ target_path: 'first.bin' }]);
  assert.deepEqual(secondRows, [{ target_path: 'second.bin' }]);
  db.close();
});

test('an empty set of all three metadata tables reports no backup batch', async (t) => {
  const fixture = await makeProfile();
  assert.deepEqual(await prepareBrowserDownloadHistory(fixture.profile), {
    archivedCount: 0,
    archivedRows: { downloads: 0, urlChains: 0, slices: 0 },
    backupBatchId: null,
  });
});

test('a fresh profile with no Default directory is a no-op', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'k-browser-history-fresh-'));
  assert.deepEqual(await prepareBrowserDownloadHistory(root), {
    archivedCount: 0,
    archivedRows: { downloads: 0, urlChains: 0, slices: 0 },
    backupBatchId: null,
  });
});

test('rejects a bad schema without changing its data', async (t) => {
  const fixture = await makeProfile({ badSchema: true });
  const db = openDb(fixture.history);
  db.exec(`INSERT INTO downloads VALUES (1, 1)`);
  db.close();

  await assert.rejects(prepareBrowserDownloadHistory(fixture.profile), /missing table downloads_url_chains/);
  const readback = openDb(fixture.history);
  assert.deepEqual(rows(readback, 'SELECT * FROM downloads'), [{ id: 1, state: 1 }]);
  assert.equal(readback.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'k_download_history_backup_%'`).get().n, 0);
  readback.close();
});

test('rejects a linked Default directory before opening its History', async (t) => {
  const fixture = await makeProfile();
  const linkedProfile = path.join(fixture.root, 'linked-profile');
  await mkdir(linkedProfile);
  const linkedDefault = path.join(fixture.root, 'real-Default');
  await mkdir(linkedDefault);
  const realHistory = path.join(linkedDefault, 'History');
  const db = new DatabaseSync(realHistory);
  db.exec('CREATE TABLE untouched (value TEXT)');
  db.close();
  try {
    await symlink(linkedDefault, path.join(linkedProfile, 'Default'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(`Windows does not permit creating the symlink fixture: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(prepareBrowserDownloadHistory(linkedProfile), /unsafe browser profile path component/);
  const readback = openDb(realHistory);
  assert.equal(readback.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'untouched'`).get().n, 1);
  readback.close();
});

function seedDownload(db, id, label) {
  db.prepare('INSERT INTO downloads VALUES (?, 1, ?)').run(id, `${label}.bin`);
  db.prepare('INSERT INTO downloads_url_chains VALUES (?, 0, ?)').run(id, `https://fake.example/${label}?token=FAKE-${label}`);
  db.prepare('INSERT INTO downloads_slices VALUES (?, ?, 0)').run(id, `${label}.bin`);
}

function restoreBatch(db, batch) {
  for (const [source, suffix] of [['downloads', 'downloads'], ['downloads_url_chains', 'url_chains'], ['downloads_slices', 'slices']]) {
    db.exec(`INSERT INTO ${source} SELECT * FROM "k_download_history_backup_${batch}_${suffix}"`);
  }
}

test('unchanged complete bundles do not create a batch, even with reordered child rows', async () => {
  const { profile, history } = await makeProfile();
  let db = openDb(history);
  seedDownload(db, 1, 'first');
  db.exec("INSERT INTO downloads_url_chains VALUES (1, 1, 'https://fake.example/redirect'); INSERT INTO downloads_slices VALUES (99, 'orphan', 0)");
  db.close();
  const first = await prepareBrowserDownloadHistory(profile);
  db = openDb(history);
  restoreBatch(db, first.backupBatchId);
  // Reverse physical row order without changing the data.
  db.exec('CREATE TEMP TABLE reversed AS SELECT * FROM downloads_url_chains ORDER BY chain_index DESC; DELETE FROM downloads_url_chains; INSERT INTO downloads_url_chains SELECT * FROM reversed');
  db.close();
  assert.deepEqual(await prepareBrowserDownloadHistory(profile), {
    archivedCount: 0, archivedRows: { downloads: 0, urlChains: 0, slices: 0 }, backupBatchId: null,
  });
  db = openDb(history);
  assert.equal(db.prepare('SELECT count(*) AS n FROM k_download_history_batches').get().n, 1);
  for (const table of ['downloads', 'downloads_url_chains', 'downloads_slices']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
  db.close();
});

test('changed children are archived with their unchanged parent; unchanged neighbours are not copied', async () => {
  const { profile, history } = await makeProfile();
  let db = openDb(history);
  seedDownload(db, 1, 'changed'); seedDownload(db, 2, 'unchanged');
  db.close();
  const first = await prepareBrowserDownloadHistory(profile);
  db = openDb(history);
  restoreBatch(db, first.backupBatchId);
  db.exec("UPDATE downloads_url_chains SET url = 'https://fake.example/new' WHERE id = 1; INSERT INTO downloads_slices VALUES (1, 'changed.bin', 0); INSERT INTO downloads_url_chains VALUES (99, 0, 'https://fake.example/orphan')");
  db.close();
  const second = await prepareBrowserDownloadHistory(profile);
  assert.deepEqual(second.archivedRows, { downloads: 1, urlChains: 2, slices: 2 });
  db = openDb(history);
  const prefix = `k_download_history_backup_${second.backupBatchId}_`;
  assert.deepEqual(rows(db, `SELECT * FROM "${prefix}downloads"`), [{ id: 1, state: 1, target_path: 'changed.bin' }]);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM "${prefix}slices"`).get().n, 2);
  restoreBatch(db, second.backupBatchId);
  db.exec('DELETE FROM downloads_url_chains WHERE id = 1');
  db.close();
  const third = await prepareBrowserDownloadHistory(profile);
  // A removed child changes its bundle too; an unchanged orphan does not.
  assert.deepEqual(third.archivedRows, { downloads: 1, urlChains: 0, slices: 2 });
});

test('fingerprints preserve 64-bit integers, NULL, binary values and changed columns', async () => {
  const { profile, history } = await makeProfile();
  let db = openDb(history);
  db.exec('ALTER TABLE downloads ADD COLUMN start_time INTEGER; ALTER TABLE downloads ADD COLUMN hash BLOB');
  db.prepare('INSERT INTO downloads VALUES (1, 1, NULL, ?, ?)').run(13434751234567890n, Buffer.from([0, 255]));
  db.close();
  const first = await prepareBrowserDownloadHistory(profile);
  db = openDb(history);
  restoreBatch(db, first.backupBatchId);
  db.close();
  assert.equal((await prepareBrowserDownloadHistory(profile)).backupBatchId, null);
  db = openDb(history);
  restoreBatch(db, first.backupBatchId);
  db.exec('UPDATE downloads SET start_time = start_time + 1');
  db.close();
  const changed = await prepareBrowserDownloadHistory(profile);
  assert.notEqual(changed.backupBatchId, first.backupBatchId);
  db = openDb(history);
  const statement = db.prepare(`SELECT * FROM "k_download_history_backup_${changed.backupBatchId}_downloads"`);
  statement.setReadBigInts(true);
  const row = statement.get();
  assert.equal(row.start_time, 13434751234567891n);
  assert.equal(row.target_path, null);
  assert.deepEqual(Buffer.from(row.hash), Buffer.from([0, 255]));
  restoreBatch(db, changed.backupBatchId);
  db.exec('ALTER TABLE downloads ADD COLUMN new_field TEXT');
  db.close();
  assert.equal((await prepareBrowserDownloadHistory(profile)).archivedRows.downloads, 1);
});

test('keeps five managed batches, retires whole families, and does not resurrect expired raw URLs', async () => {
  const { profile, history } = await makeProfile();
  const batches = [];
  for (let i = 0; i < 8; i++) {
    const db = openDb(history);
    seedDownload(db, i, `round-${i}`);
    db.close();
    batches.push((await prepareBrowserDownloadHistory(profile)).backupBatchId);
  }
  let db = openDb(history);
  assert.deepEqual(rows(db, 'SELECT batch_id FROM k_download_history_batches ORDER BY ordinal').map((r) => r.batch_id), batches.slice(-5));
  const names = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'k_download_history_backup_%'").all().map((r) => r.name);
  assert.equal(names.length, 15);
  for (const batch of batches.slice(0, 3)) assert.equal(names.some((name) => name.includes(batch)), false);
  for (const name of names.filter((n) => n.endsWith('_url_chains'))) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM "${name}" WHERE url LIKE '%FAKE-round-0'`).get().n, 0);
  }
  seedDownload(db, 0, 'round-0');
  db.close();
  assert.equal((await prepareBrowserDownloadHistory(profile)).backupBatchId, null);
  db = openDb(history);
  assert.equal(db.prepare('SELECT count(*) AS n FROM downloads').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM k_download_history_seen').get().n, 8);
  assert.equal(db.prepare('SELECT count(*) AS n FROM cookies').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM visits').get().n, 1);
  db.close();
});

test('undated legacy batches are learned but neither ordered by random UUID nor automatically pruned', async () => {
  const { profile, history } = await makeProfile();
  let db = openDb(history);
  const legacyIds = [];
  for (let i = 0; i < 6; i++) {
    const batch = (20 - i).toString(16).padStart(32, '0'); legacyIds.push(batch);
    seedDownload(db, i, `legacy-${i}`);
    for (const [source, suffix] of [['downloads', 'downloads'], ['downloads_url_chains', 'url_chains'], ['downloads_slices', 'slices']]) {
      db.exec(`CREATE TABLE "k_download_history_backup_${batch}_${suffix}" AS SELECT * FROM ${source}; DELETE FROM ${source}`);
    }
  }
  restoreBatch(db, legacyIds[0]);
  db.close();
  assert.equal((await prepareBrowserDownloadHistory(profile)).backupBatchId, null);
  for (let i = 0; i < 7; i++) {
    db = openDb(history); seedDownload(db, 100 + i, `new-${i}`); db.close();
    await prepareBrowserDownloadHistory(profile);
  }
  db = openDb(history);
  assert.equal(db.prepare('SELECT count(*) AS n FROM k_download_history_batches').get().n, 5);
  for (const id of legacyIds) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM "k_download_history_backup_${id}_downloads"`).get().n, 1);
  }
  db.close();
});

test('failure during retirement rolls back new backup, native clearing, fingerprints and prior dropped tables', async () => {
  const { profile, history } = await makeProfile();
  const batches = [];
  for (let i = 0; i < 5; i++) {
    const db = openDb(history); seedDownload(db, i, `round-${i}`); db.close();
    batches.push((await prepareBrowserDownloadHistory(profile)).backupBatchId);
  }
  let db = openDb(history);
  // Deliberately damage only this synthetic fixture to fail the second DROP.
  db.exec(`DROP TABLE "k_download_history_backup_${batches[0]}_url_chains"`);
  seedDownload(db, 99, 'must-remain');
  const before = rows(db, 'SELECT name FROM sqlite_master ORDER BY name');
  db.close();
  await assert.rejects(prepareBrowserDownloadHistory(profile), /no such table/);
  db = openDb(history);
  assert.deepEqual(rows(db, 'SELECT name FROM sqlite_master ORDER BY name'), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM k_download_history_seen').get().n, 5);
  assert.deepEqual(rows(db, 'SELECT id, target_path FROM downloads'), [{ id: 99, target_path: 'must-remain.bin' }]);
  db.close();
});
