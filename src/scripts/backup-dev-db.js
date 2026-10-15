/**
 * Daily SQLite backup of the Directory database.
 *
 * Uses SQLite's own online-backup path (`VACUUM INTO`), which produces a consistent snapshot
 * while the site keeps serving reads and writes — this is NOT a raw file copy, so it cannot
 * capture a half-written database file. (Node's built-in `node:sqlite` does not expose the
 * `backup()` C API, so VACUUM INTO is the supported equivalent.)
 *
 * Retention: 14 days. Older files are deleted after a successful backup.
 * Destination: <home>\AppData\Local\Directory-Services\backups (override with
 * DIRECTORY_BACKUP_DIR).
 *
 * Restore note (also in the hosting runbook):
 *   1. Stop the site: stop the process listening on 5050.
 *   2. Copy the chosen backup over prisma\dev.db  (e.g. dev-YYYY-MM-DD.db -> prisma\dev.db).
 *   3. Start it again: Start-ScheduledTask -TaskName 'Vancouver Directory (5050)'.
 *   4. Check http://127.0.0.1:5050/api/health and a listing page.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.DIRECTORY_DB ||
  path.join(__dirname, '..', '..', 'prisma', 'dev.db');
const OUT_DIR = process.env.DIRECTORY_BACKUP_DIR ||
  '<home>/AppData/Local/Directory-Services/backups';
const RETENTION_DAYS = Number(process.env.DIRECTORY_BACKUP_RETENTION_DAYS || 14);

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main() {
  if (!fs.existsSync(DB)) {
    console.error(`backup: database not found at ${DB}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `dev-${stamp()}.db`);
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });

  const db = new DatabaseSync(DB);
  try {
    const literal = target.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${literal}'`);
  } finally {
    db.close();
  }

  // Verify the snapshot before trusting it.
  const copy = new DatabaseSync(target, { readOnly: true });
  let businessCount = null;
  let tableCount = null;
  try {
    businessCount = copy.prepare('SELECT COUNT(*) AS n FROM businesses').get().n;
    tableCount = copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    const integrity = copy.prepare('PRAGMA integrity_check').get();
    if (String(Object.values(integrity)[0]).toLowerCase() !== 'ok') {
      throw new Error(`integrity check failed: ${JSON.stringify(integrity)}`);
    }
  } finally {
    copy.close();
  }

  const size = fs.statSync(target).size;
  console.log(`${new Date().toISOString()} backup ok: ${target} (${size} bytes, ${businessCount} businesses, ${tableCount} tables)`);

  // Retention: keep the newest RETENTION_DAYS files.
  const files = fs.readdirSync(OUT_DIR)
    .filter((name) => /^dev-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse();
  for (const name of files.slice(RETENTION_DAYS)) {
    fs.rmSync(path.join(OUT_DIR, name), { force: true });
    console.log(`removed old backup ${name}`);
  }
  console.log(`kept ${Math.min(files.length, RETENTION_DAYS)} backups in ${OUT_DIR}`);
}

main();
