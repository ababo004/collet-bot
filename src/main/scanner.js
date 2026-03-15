const log = require('electron-log')
const { upsertInvoice, getOpenInvoices, getSetting } = require('./db')

function daysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function seedDevInvoices() {
  const samples = [
    { id: 'DEV-INV-001', client_name: 'Acme Corp',       client_email: 'billing@acme.com',    amount: 2500,  currency: 'USD', due_date: daysFromNow(-7),  source: 'dev', status: 'open' },
    { id: 'DEV-INV-002', client_name: 'Globex Inc',       client_email: 'ap@globex.com',        amount: 8750,  currency: 'USD', due_date: daysFromNow(-14), source: 'dev', status: 'open' },
    { id: 'DEV-INV-003', client_name: 'Initech LLC',      client_email: 'invoices@initech.com', amount: 1200,  currency: 'USD', due_date: daysFromNow(5),   source: 'dev', status: 'open' },
    { id: 'DEV-INV-004', client_name: 'Umbrella Corp',    client_email: 'finance@umbrella.com', amount: 15000, currency: 'USD', due_date: daysFromNow(-30), source: 'dev', status: 'open' },
    { id: 'DEV-INV-005', client_name: 'Stark Industries', client_email: 'ar@stark.com',         amount: 42000, currency: 'USD', due_date: daysFromNow(-3),  source: 'dev', status: 'open' },
  ]
  for (const inv of samples) upsertInvoice(inv)
  log.info(`[DEV] Seeded ${samples.length} mock invoices`)
}

async function fetchInvoices() {
  const invoices = []
  const accountingSource = getSetting('accounting_source')

  if (accountingSource === 'quickbooks' || accountingSource === 'both') {
    try {
      const { fetchInvoices: fetchQB } = require('../integrations/quickbooks')
      const qbInvoices = await fetchQB()
      invoices.push(...qbInvoices)
      log.info(`QuickBooks: fetched ${qbInvoices.length} invoices`)
    } catch (err) {
      log.error('QuickBooks fetch error:', err.message)
    }
  }

  if (accountingSource === 'xero' || accountingSource === 'both') {
    try {
      const { fetchInvoices: fetchXero } = require('../integrations/xero')
      const xeroInvoices = await fetchXero()
      invoices.push(...xeroInvoices)
      log.info(`Xero: fetched ${xeroInvoices.length} invoices`)
    } catch (err) {
      log.error('Xero fetch error:', err.message)
    }
  }

  return invoices
}

async function syncInvoicesToDb(invoices) {
  let synced = 0
  for (const invoice of invoices) {
    if (invoice.status === 'PAID' || invoice.status === 'VOIDED') {
      upsertInvoice({ ...invoice, status: 'paid' })
    } else {
      upsertInvoice({ ...invoice, status: 'open' })
    }
    synced++
  }
  log.info(`Synced ${synced} invoices to local DB`)
  return synced
}

function getDaysRelativeToDueDate(dueDateStr) {
  const dueDate = new Date(dueDateStr)
  dueDate.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = today - dueDate
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

async function scan() {
  log.info('=== COLLET SCAN STARTED ===')

  if (process.env.NODE_ENV === 'development') {
    // In dev mode, use seeded mock invoices instead of calling real APIs
    seedDevInvoices()
  } else {
    const rawInvoices = await fetchInvoices()
    if (rawInvoices.length === 0) {
      log.info('No invoices fetched from accounting sources')
      return { scanned: 0, sequencesTriggered: 0 }
    }
    await syncInvoicesToDb(rawInvoices)
  }

  const openInvoices = getOpenInvoices()
  log.info(`${openInvoices.length} open invoices loaded from DB`)

  const { processSequences } = require('./sequencer')
  const { detectPayments } = require('./detector')

  const paymentResults = await detectPayments(openInvoices)
  log.info(`Payment detection: ${paymentResults.detected} payments found`)

  // Sync paid invoices to HubSpot CRM if connected
  if (paymentResults.detected > 0 && getSetting('crm_source') === 'hubspot') {
    try {
      const { updateContactPaymentStatus } = require('../integrations/hubspot')
      for (const inv of paymentResults.invoices) {
        await updateContactPaymentStatus(inv.client_email, inv.id, 'PAID')
      }
      log.info(`HubSpot: synced ${paymentResults.invoices.length} paid invoice(s)`)
    } catch (err) {
      log.error('HubSpot sync error:', err.message)
    }
  }

  const refreshedInvoices = getOpenInvoices()
  const sequenceResults = await processSequences(refreshedInvoices)

  log.info(`=== SCAN COMPLETE: ${sequenceResults.sent} emails sent ===`)
  return {
    scanned: refreshedInvoices.length,
    sequencesTriggered: sequenceResults.sent
  }
}

module.exports = { scan, fetchInvoices, getDaysRelativeToDueDate }
