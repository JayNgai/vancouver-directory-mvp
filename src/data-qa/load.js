'use strict';
/**
 * Read-only loader for the live directory database (prisma/dev.db).
 * Uses node:sqlite in readOnly mode — this tool never writes to the directory DB.
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DIRECTORY_DB || path.join(__dirname, '..', '..', 'prisma', 'dev.db');

const COLUMNS =
  'id, name, slug, category, primaryCategory, tags, address, latitude, longitude, phone, website, hours, description, imageUrl, isVerified, cityLicenceStatus, dataSources';

/** Load all businesses, or a deterministic first-N sample when `limit` is set. */
function loadBusinesses({ limit = null, dbPath = DB_PATH } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sql = limit
      ? `SELECT ${COLUMNS} FROM businesses ORDER BY id LIMIT ?`
      : `SELECT ${COLUMNS} FROM businesses ORDER BY id`;
    return limit ? db.prepare(sql).all(limit) : db.prepare(sql).all();
  } finally {
    db.close();
  }
}

module.exports = { loadBusinesses, DB_PATH, COLUMNS };