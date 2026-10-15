const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const os = require('os');

const db = new DatabaseSync(path.join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
console.log('backup function type:', typeof db.backup);
console.log('sqlite version:', db.prepare('select sqlite_version() as v').get().v);
console.log('db methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(db)).join(', '));

if (typeof db.backup === 'function') {
  const target = path.join(os.tmpdir(), `backup-probe-${Date.now()}.db`);
  db.backup(target).then((pages) => {
    console.log('backup ok, pages:', pages, 'size:', fs.statSync(target).size);
    const copy = new DatabaseSync(target, { readOnly: true });
    console.log('rows in backup:', copy.prepare('select count(*) as n from businesses').get().n);
    copy.close();
    fs.rmSync(target, { force: true });
    db.close();
  }).catch((error) => {
    console.log('backup failed:', error.message);
    db.close();
  });
} else {
  db.close();
}
