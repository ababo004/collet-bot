const log = require('electron-log')
const { getSetting, markInvoicePaid } = require('./db')

const PAYMENT_KEYWORDS = [
  'payment',
  'paid',
  'receipt',
  'transaction',
  'remittance',
  'confirmation',
  'bank transfer',
  'wire transfer',
  'ach',
  'cleared',
  'settlement'
]

async function scanInboxForPayments(invoices) {
  const provider = getSetting('email_provider')
  if (!provider) return []

  const clientEmails = [...new Set(invoices.map(inv => inv.client_email.toLowerCase()))]
  const matches = []

  try {
    if (provider === 'gmail') {
      const { searchInboxForPayments } = require('../integrations/gmail')
      const results = await searchInboxForPayments(clientEmails, PAYMENT_KEYWORDS)
      matches.push(...results)
    } else if (provider === 'outlook') {
      const { searchInboxForPayments } = require('../integrations/outlook')
      const results = await searchInboxForPayments(clientEmails, PAYMENT_KEYWORDS)
      matches.push(...results)
    }
  } catch (err) {
    log.error('Inbox scan error:', err.message)
  }

  return matches
}

function matchEmailToInvoice(emailMessage, invoices) {
  const fromEmail = emailMessage.from?.toLowerCase() || ''
  const subject = emailMessage.subject?.toLowerCase() || ''
  const body = emailMessage.body?.toLowerCase() || ''
  const content = subject + ' ' + body

  const hasPaymentKeyword = PAYMENT_KEYWORDS.some(kw => content.includes(kw))
  if (!hasPaymentKeyword) return null

  const matchedInvoice = invoices.find(inv => {
    const clientEmail = inv.client_email.toLowerCase()
    if (fromEmail.includes(clientEmail) || clientEmail.includes(fromEmail.split('@')[0])) {
      return true
    }
    const invoiceIdMentioned = content.includes(inv.id.toLowerCase()) ||
      content.includes(`invoice #${inv.id}`.toLowerCase()) ||
      content.includes(`inv #${inv.id}`.toLowerCase())
    return invoiceIdMentioned
  })

  return matchedInvoice || null
}

async function detectPayments(invoices) {
  if (!invoices || invoices.length === 0) return { detected: 0, invoices: [] }

  const emailMessages = await scanInboxForPayments(invoices)
  const paidInvoices = []

  for (const message of emailMessages) {
    const match = matchEmailToInvoice(message, invoices)
    if (match) {
      log.info(`Payment detected for invoice ${match.id} from ${message.from}`)
      markInvoicePaid(match.id)
      paidInvoices.push(match)
    }
  }

  return {
    detected: paidInvoices.length,
    invoices: paidInvoices
  }
}

module.exports = { detectPayments, matchEmailToInvoice, PAYMENT_KEYWORDS }
