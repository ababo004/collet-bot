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

// ── Fetch invoices from all connected accounting sources ────────────────────

async function fetchInvoices() {
  const invoices        = []
  const accountingSource = getSetting('accounting_source')

  if (accountingSource === 'quickbooks') {
    try {
      const { fetchInvoices: fetchQB } = require('../integrations/quickbooks')
      const items = await fetchQB()
      invoices.push(...items)
      log.info(`QuickBooks: fetched ${items.length} invoices`)
    } catch (err) {
      log.error('QuickBooks fetch error:', err.message)
    }
  }

  if (accountingSource === 'xero') {
    try {
      const { fetchInvoices: fetchXero } = require('../integrations/xero')
      const items = await fetchXero()
      invoices.push(...items)
      log.info(`Xero: fetched ${items.length} invoices`)
    } catch (err) {
      log.error('Xero fetch error:', err.message)
    }
  }

  if (accountingSource === 'freshbooks') {
    try {
      const { fetchInvoices: fetchFB } = require('../integrations/freshbooks')
      const items = await fetchFB()
      invoices.push(...items)
      log.info(`FreshBooks: fetched ${items.length} invoices`)
    } catch (err) {
      log.error('FreshBooks fetch error:', err.message)
    }
  }

  if (accountingSource === 'wave') {
    try {
      const { fetchInvoices: fetchWave } = require('../integrations/wave')
      const items = await fetchWave()
      invoices.push(...items)
      log.info(`Wave: fetched ${items.length} invoices`)
    } catch (err) {
      log.error('Wave fetch error:', err.message)
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

// ── Sync paid invoices back to all connected CRMs ───────────────────────────

async function syncPaidInvoicesToCRM(paidInvoices) {
  const crmSource = getSetting('crm_source')
  if (!crmSource || paidInvoices.length === 0) return

  for (const inv of paidInvoices) {
    const email = inv.client_email
    if (!email) continue

    // HubSpot
    if (crmSource === 'hubspot') {
      try {
        const { updateContactPaymentStatus } = require('../integrations/hubspot')
        await updateContactPaymentStatus(email, inv.id, 'PAID')
      } catch (err) {
        log.error('HubSpot CRM sync error:', err.message)
      }
    }

    // Salesforce
    if (crmSource === 'salesforce') {
      try {
        const { findContactByEmail, markOpportunityPaid } = require('../integrations/salesforce')
        const contact = await findContactByEmail(email)
        if (contact) await markOpportunityPaid(contact.id)
      } catch (err) {
        log.error('Salesforce CRM sync error:', err.message)
      }
    }

    // Zoho
    if (crmSource === 'zoho') {
      try {
        const { findContactByEmail, markDealPaid } = require('../integrations/zoho')
        const contact = await findContactByEmail(email)
        if (contact) await markDealPaid(contact.id)
      } catch (err) {
        log.error('Zoho CRM sync error:', err.message)
      }
    }
  }

  log.info(`CRM sync complete for ${paidInvoices.length} paid invoice(s) via ${crmSource}`)
}

// ── Detect payments via connected payment sources ───────────────────────────

async function detectPaymentSourcePayments(openInvoices) {
  const paymentSource = getSetting('payment_source')
  if (!paymentSource || openInvoices.length === 0) return {}

  const emails = openInvoices.map(inv => inv.client_email?.toLowerCase()).filter(Boolean)
  let results = {}

  if (paymentSource === 'stripe') {
    try {
      const { detectPayments } = require('../integrations/stripe')
      results = await detectPayments(emails)
      log.info(`Stripe payment scan: ${Object.keys(results).length} matches`)
    } catch (err) {
      log.error('Stripe payment scan error:', err.message)
    }
  }

  if (paymentSource === 'paypal') {
    try {
      const { detectPayments } = require('../integrations/paypal')
      results = { ...results, ...(await detectPayments(emails)) }
      log.info(`PayPal payment scan: ${Object.keys(results).length} matches`)
    } catch (err) {
      log.error('PayPal payment scan error:', err.message)
    }
  }

  return results
}

// ── Main scan orchestrator ───────────────────────────────────────────────────

async function scan() {
  log.info('=== COLLET SCAN STARTED ===')

  if (process.env.NODE_ENV === 'development') {
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

  // 1. Detect payments via email inbox
  const { detectPayments } = require('./detector')
  const emailPayments = await detectPayments(openInvoices)
  log.info(`Email payment detection: ${emailPayments.detected} payments found`)

  // 2. Detect payments via Stripe / PayPal
  const paymentSourceMatches = await detectPaymentSourcePayments(openInvoices)
  if (Object.keys(paymentSourceMatches).length > 0) {
    for (const inv of openInvoices) {
      const email = inv.client_email?.toLowerCase()
      if (email && paymentSourceMatches[email]) {
        const { upsertInvoice: ui } = require('./db')
        ui({ ...inv, status: 'paid' })
        log.info(`Payment source confirmed paid: ${inv.id} (${email})`)
      }
    }
  }

  // 3. Sync all paid invoices to CRM
  const allPaid = emailPayments.invoices || []
  for (const inv of openInvoices) {
    const email = inv.client_email?.toLowerCase()
    if (email && paymentSourceMatches[email] && !allPaid.find(p => p.id === inv.id)) {
      allPaid.push(inv)
    }
  }
  await syncPaidInvoicesToCRM(allPaid)

  // 4. Run email sequences for remaining open invoices
  const refreshedInvoices = getOpenInvoices()
  const { processSequences } = require('./sequencer')
  const sequenceResults = await processSequences(refreshedInvoices)

  log.info(`=== SCAN COMPLETE: ${sequenceResults.sent} emails sent ===`)
  return {
    scanned:            refreshedInvoices.length,
    sequencesTriggered: sequenceResults.sent
  }
}

module.exports = { scan, fetchInvoices, getDaysRelativeToDueDate }
