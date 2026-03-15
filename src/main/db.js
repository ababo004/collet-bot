const path = require('path')
const { app } = require('electron')
const Database = require('better-sqlite3')

let db = null

function getDb() {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'collet.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initSchema()
  return db
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      client_name TEXT,
      client_email TEXT,
      amount REAL,
      due_date TEXT,
      source TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sequence_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT,
      stage TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      email_to TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_sequence_log_invoice ON sequence_log(invoice_id);
  `)
}

function upsertInvoice(invoice) {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO invoices (id, client_name, client_email, amount, due_date, source, status)
    VALUES (@id, @client_name, @client_email, @amount, @due_date, @source, @status)
    ON CONFLICT(id) DO UPDATE SET
      client_name = excluded.client_name,
      client_email = excluded.client_email,
      amount = excluded.amount,
      due_date = excluded.due_date,
      status = CASE WHEN invoices.status = 'paid' THEN 'paid' ELSE excluded.status END
  `)
  return stmt.run(invoice)
}

function getOpenInvoices() {
  const db = getDb()
  return db.prepare(`SELECT * FROM invoices WHERE status = 'open'`).all()
}

function markInvoicePaid(invoiceId) {
  const db = getDb()
  return db.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoiceId)
}

function markInvoiceHalted(invoiceId) {
  const db = getDb()
  return db.prepare(`UPDATE invoices SET status = 'halted' WHERE id = ?`).run(invoiceId)
}

function hasStageBeenSent(invoiceId, stage) {
  const db = getDb()
  const row = db.prepare(`
    SELECT id FROM sequence_log
    WHERE invoice_id = ? AND stage = ? AND status = 'sent'
  `).get(invoiceId, stage)
  return !!row
}

function logSequenceAction(invoiceId, stage, emailTo, subject, status) {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO sequence_log (invoice_id, stage, email_to, subject, status)
    VALUES (?, ?, ?, ?, ?)
  `)
  return stmt.run(invoiceId, stage, emailTo, subject, status)
}

function getSetting(key, defaultValue = null) {
  const db = getDb()
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)
  return row ? row.value : defaultValue
}

function setSetting(key, value) {
  const db = getDb()
  return db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function getSequenceLogs(limit = 100) {
  const db = getDb()
  return db.prepare(`
    SELECT sl.*, i.client_name, i.amount
    FROM sequence_log sl
    JOIN invoices i ON sl.invoice_id = i.id
    ORDER BY sl.sent_at DESC
    LIMIT ?
  `).all(limit)
}

function getStats() {
  const db = getDb()
  const total = db.prepare(`SELECT COUNT(*) as count FROM invoices`).get()
  const open = db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE status = 'open'`).get()
  const active = db.prepare(`
    SELECT COUNT(DISTINCT invoice_id) as count FROM sequence_log
    WHERE invoice_id IN (SELECT id FROM invoices WHERE status = 'open')
  `).get()
  const lastScan = getSetting('last_scan_at')
  return {
    total: total.count,
    open: open.count,
    active: active.count,
    lastScan
  }
}

module.exports = {
  getDb,
  upsertInvoice,
  getOpenInvoices,
  markInvoicePaid,
  markInvoiceHalted,
  hasStageBeenSent,
  logSequenceAction,
  getSetting,
  setSetting,
  getSequenceLogs,
  getStats
}
