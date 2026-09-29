import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const REQUIRED_COLUMNS = {
  downloads: ['id', 'state'],
  downloads_url_chains: ['id'],
  downloads_slices: ['download_id'],
};
const ARCHIVE_TABLES = [
  { source: 'downloads', suffix: 'downloads', id: 'id', key: 'downloads' },
  { source: 'downloads_url_chains', suffix: 'url_chains', id: 'id', key: 'urlChains' },
  { source: 'downloads_slices', suffix: 'slices', id: 'download_id', key: 'slices' },
];
const BATCH_TABLE = 'k_download_history_batches';
const SEEN_TABLE = 'k_download_history_seen';
const MAX_BATCHES = 5;
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const backupName = (batch, suffix) => `k_download_history_backup_${batch}_${suffix}`;

// SQLite integers (Chromium timestamps in particular) can exceed Number's safe
// range. Type-tag values before hashing, including NULL and binary hash columns.
function valueKey(value) {
  if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('hex')];
  return [typeof value, typeof value === 'bigint' ? value.toString() : value];
}

function readBundles(db, names) {
  const bundles = new Map();
  const columns = names.map((name) => db.prepare(`PRAGMA table_info(${quote(name)})`).all().map((c) => c.name).sort());
  for (const [index, name] of names.entries()) {
    if (!columns[index].includes(ARCHIVE_TABLES[index].id)) {
      throw new Error(`Unsupported download backup schema: ${name}`);
    }
    const statement = db.prepare(`SELECT * FROM ${quote(name)}`);
    statement.setReadBigInts(true);
    for (const row of statement.all()) {
      const key = JSON.stringify(valueKey(row[ARCHIVE_TABLES[index].id]));
      if (!bundles.has(key)) bundles.set(key, [[], [], []]);
      bundles.get(key)[index].push(columns[index].map((column) => row[column]));
    }
  }
  return { columns, bundles: [...bundles.values()].map((rows) => ({
    rows,
    fingerprint: createHash('sha256').update(JSON.stringify([
      columns, rows.map((group) => group.map((row) => JSON.stringify(row.map(valueKey))).sort()),
    ])).digest('hex'),
  })) };
}

function initializeArchive(db) {
  const hadSeen = db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(SEEN_TABLE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${BATCH_TABLE} (batch_id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS ${SEEN_TABLE} (fingerprint TEXT PRIMARY KEY);
  `);
  // Old UUID-only batches have no trustworthy creation order. Learn their
  // fingerprints once, but do not silently age out or delete legacy user data.
  if (!hadSeen) {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const batches = new Set([...tables].map((name) => /^k_download_history_backup_([a-f0-9]{32})_(downloads|url_chains|slices)$/.exec(name)?.[1]).filter(Boolean));
    const remember = db.prepare(`INSERT OR IGNORE INTO ${SEEN_TABLE} VALUES (?)`);
    for (const batch of batches) {
      const names = ARCHIVE_TABLES.map((t) => backupName(batch, t.suffix));
      if (names.some((name) => !tables.has(name))) throw new Error('Incomplete legacy download backup batch');
      for (const bundle of readBundles(db, names).bundles) remember.run(bundle.fingerprint);
    }
  }
}

function pruneManagedBatches(db) {
  const batches = db.prepare(`SELECT batch_id FROM ${BATCH_TABLE} ORDER BY ordinal DESC`).all();
  for (const { batch_id: batch } of batches.slice(MAX_BATCHES)) {
    if (!/^[a-f0-9]{32}$/.test(batch)) throw new Error('Invalid managed download backup batch');
    for (const table of ARCHIVE_TABLES) db.exec(`DROP TABLE ${quote(backupName(batch, table.suffix))}`);
    db.prepare(`DELETE FROM ${BATCH_TABLE} WHERE batch_id = ?`).run(batch);
  }
}
async function assertSafeDirectoryTree(directory) {
  const absolute = path.resolve(directory);
  const { root } = path.parse(absolute);
  let current = root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);

  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Refusing unsafe browser profile path component: ${current}`);
    }
  }
  return absolute;
}

async function assertRegularFile(file) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Refusing unsafe browser history file: ${file}`);
  }
}

async function lstatIfPresent(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertSidecarsSafe(historyPath) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${historyPath}${suffix}`;
    try {
      const info = await lstat(sidecar);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`Refusing unsafe browser history sidecar: ${sidecar}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function assertSchema(db) {
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const entry = db.prepare(`SELECT type FROM sqlite_master WHERE name = ?`).get(table);
    if (entry?.type !== 'table') {
      throw new Error(`Unsupported browser History schema: missing table ${table}`);
    }
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (columns.length === 0) throw new Error(`Unsupported browser History schema: missing ${table}`);
    const names = new Set(columns.map((column) => column.name));
    const missing = required.filter((name) => !names.has(name));
    if (missing.length) {
      throw new Error(`Unsupported browser History schema: ${table} missing ${missing.join(', ')}`);
    }
  }
  const triggers = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name IN ('downloads', 'downloads_url_chains', 'downloads_slices')
  `).all();
  if (triggers.length) {
    throw new Error('Unsupported browser History schema: download-table triggers are present');
  }
}

/**
 * Archive Chromium's three download-metadata tables in an existing profile's
 * Default/History. New/changed complete download bundles are backed up before
 * clearing native tables, in one transaction. Only the last five managed batches
 * are retained; fingerprints prevent already expired records from being re-saved.
 * Legacy undated batches and non-download browser data are not removed.
 */
export async function prepareBrowserDownloadHistory(profile) {
  if (typeof profile !== 'string' || profile.length === 0 || !path.isAbsolute(profile)) {
    throw new TypeError('profile must be an absolute path');
  }

  const safeProfile = await assertSafeDirectoryTree(profile);
  const defaultPath = path.join(safeProfile, 'Default');
  const defaultInfo = await lstatIfPresent(defaultPath);
  if (!defaultInfo) {
    return { archivedCount: 0, archivedRows: { downloads: 0, urlChains: 0, slices: 0 }, backupBatchId: null };
  }
  if (defaultInfo.isSymbolicLink() || !defaultInfo.isDirectory()) {
    throw new Error(`Refusing unsafe browser profile path component: ${defaultPath}`);
  }

  const historyPath = path.join(defaultPath, 'History');
  if (!await lstatIfPresent(historyPath)) {
    return { archivedCount: 0, archivedRows: { downloads: 0, urlChains: 0, slices: 0 }, backupBatchId: null };
  }
  await assertRegularFile(historyPath);
  await assertSidecarsSafe(historyPath);

  // Import only after establishing that this is an existing, ordinary profile DB;
  // node:sqlite is experimental on supported Node releases and emits a warning.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(historyPath);
  try {
    db.exec('BEGIN EXCLUSIVE');
    try {
      assertSchema(db);
      const nativeRows = {
        downloads: db.prepare('SELECT count(*) AS count FROM downloads').get().count,
        urlChains: db.prepare('SELECT count(*) AS count FROM downloads_url_chains').get().count,
        slices: db.prepare('SELECT count(*) AS count FROM downloads_slices').get().count,
      };
      const archivedRows = { downloads: 0, urlChains: 0, slices: 0 };
      if (Object.values(nativeRows).every((n) => n === 0)) {
        db.exec('COMMIT');
        return { archivedCount: 0, archivedRows, backupBatchId: null };
      }

      initializeArchive(db);
      const { columns, bundles } = readBundles(db, ARCHIVE_TABLES.map((t) => t.source));
      const seen = db.prepare(`SELECT 1 FROM ${SEEN_TABLE} WHERE fingerprint = ?`);
      const fresh = bundles.filter((bundle) => !seen.get(bundle.fingerprint));
      const batchId = fresh.length ? randomUUID().replaceAll('-', '') : null;
      if (batchId) {
        const insert = ARCHIVE_TABLES.map((table, index) => {
          const name = quote(backupName(batchId, table.suffix));
          db.exec(`CREATE TABLE ${name} AS SELECT * FROM ${table.source} WHERE 0`);
          return db.prepare(`INSERT INTO ${name} (${columns[index].map(quote).join(',')}) VALUES (${columns[index].map(() => '?').join(',')})`);
        });
        const remember = db.prepare(`INSERT INTO ${SEEN_TABLE} VALUES (?)`);
        for (const bundle of fresh) {
          for (const [index, group] of bundle.rows.entries()) {
            for (const row of group) insert[index].run(...row);
            archivedRows[ARCHIVE_TABLES[index].key] += group.length;
          }
          remember.run(bundle.fingerprint);
        }
        db.prepare(`INSERT INTO ${BATCH_TABLE} SELECT ?, COALESCE(MAX(ordinal), 0) + 1 FROM ${BATCH_TABLE}`).run(batchId);
      }

      db.exec(`
        DELETE FROM downloads_url_chains;
        DELETE FROM downloads_slices;
        DELETE FROM downloads;
      `);
      pruneManagedBatches(db);
      db.exec('COMMIT');
      const archivedCount = Object.values(archivedRows).reduce((sum, n) => sum + n, 0);
      return { archivedCount, archivedRows, backupBatchId: batchId };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  } finally {
    db.close();
  }
}
