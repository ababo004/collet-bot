const log = require('electron-log')
const { hasStageBeenSent, logSequenceAction, getSetting } = require('./db')
const { sendEmail } = require('./sender')
const { getDaysRelativeToDueDate } = require('./scanner')
const templates = require('../templates')

const SEQUENCE_STAGES = [
  { stage: 'pre-due',      minDays: -8,  maxDays: -6  },
  { stage: 'due-today',    minDays: -1,  maxDays: 1   },
  { stage: 'follow-up',    minDays: 2,   maxDays: 5   },
  { stage: 'notice',       minDays: 8,   maxDays: 14  },
  { stage: 'final-notice', minDays: 18,  maxDays: 999 }
]

function determineStage(daysOverdue) {
  for (const s of SEQUENCE_STAGES) {
    if (daysOverdue >= s.minDays && daysOverdue <= s.maxDays) {
      return s.stage
    }
  }
  return null
}

async function processInvoice(invoice) {
  const daysRelative = getDaysRelativeToDueDate(invoice.due_date)
  const stage = determineStage(daysRelative)

  if (!stage) {
    log.debug(`Invoice ${invoice.id}: no applicable stage (days: ${daysRelative})`)
    return { status: 'no_stage' }
  }

  if (await hasStageBeenSent(invoice.id, stage)) {
    log.debug(`Invoice ${invoice.id}: stage '${stage}' already sent`)
    return { status: 'already_sent', stage }
  }

  const templateFn = templates[stage]
  if (!templateFn) {
    log.error(`No template for stage: ${stage}`)
    return { status: 'error', stage }
  }

  const daysOverdue = Math.max(0, daysRelative)

  // Optionally enrich client_name with HubSpot first name for personalization
  let clientName = invoice.client_name
  if (getSetting('crm_source') === 'hubspot') {
    try {
      const { getContactByEmail } = require('../integrations/hubspot')
      const contact = await getContactByEmail(invoice.client_email)
      if (contact?.firstName) clientName = contact.firstName
    } catch {
      // Non-fatal: fall back to invoice client name
    }
  }

  const emailData = templateFn({
    invoice_number: invoice.id,
    client_name: clientName,
    amount: formatCurrency(invoice.amount),
    due_date: formatDate(invoice.due_date),
    days_overdue: daysOverdue,
    sender_name: getSetting('sender_name') || 'Accounts Receivable',
    pay_link: getSetting('pay_link') || '#'
  })

  try {
    await sendEmail({
      to: invoice.client_email,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text
    })

    logSequenceAction(invoice.id, stage, invoice.client_email, emailData.subject, 'sent')
    log.info(`Invoice ${invoice.id}: sent '${stage}' to ${invoice.client_email}`)
    return { status: 'sent', stage }
  } catch (err) {
    logSequenceAction(invoice.id, stage, invoice.client_email, emailData.subject, 'failed')
    log.error(`Invoice ${invoice.id}: failed to send '${stage}' — ${err.message}`)
    return { status: 'failed', stage, error: err.message }
  }
}

async function processSequences(invoices) {
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const invoice of invoices) {
    const result = await processInvoice(invoice)

    if (result.status === 'sent') sent++
    else if (result.status === 'failed') failed++
    else skipped++
  }

  log.info(`Sequences: ${sent} sent, ${failed} failed, ${skipped} skipped`)
  return { sent, failed, skipped }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount)
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

module.exports = { processSequences, processInvoice, determineStage }
