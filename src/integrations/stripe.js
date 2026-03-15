/**
 * Stripe integration — API key + payment detection
 *
 * Required: STRIPE_SECRET_KEY stored in keychain (no OAuth — Stripe uses secret keys).
 *
 * Used to:
 *   - Detect when a PaymentIntent / charge succeeds for a client's email
 *   - Cross-reference Stripe charges with open invoices to auto-mark them paid
 *
 * Stripe API: https://stripe.com/docs/api
 */

const keytar = require('../main/keytar-safe')
const axios  = require('axios')
const log    = require('electron-log')
const { setSetting } = require('../main/db')

const SERVICE_NAME = 'com.collet.app'
const API_BASE     = 'https://api.stripe.com/v1'

// ── Connect (store secret key) ─────────────────────────────────────────────

async function connectStripe(secretKey) {
  if (!secretKey || !secretKey.startsWith('sk_')) {
    return { ok: false, error: 'Invalid Stripe secret key (must start with sk_)' }
  }

  try {
    // Validate key with a lightweight call
    const res = await axios.get(`${API_BASE}/account`, {
      auth: { username: secretKey, password: '' }
    })

    const account = res.data
    await keytar.setPassword(SERVICE_NAME, 'stripe_secret_key', secretKey)
    setSetting('payment_source', 'stripe')
    setSetting('stripe_account_id', account.id)

    log.info(`Stripe connected (${account.email}, ${account.id})`)
    return { ok: true, email: account.email, accountId: account.id, provider: 'stripe' }
  } catch (err) {
    log.error('Stripe connect error:', err.response?.data?.error?.message || err.message)
    return { ok: false, error: err.response?.data?.error?.message || err.message }
  }
}

/**
 * Search Stripe charges in the last N days for a set of client emails.
 * Returns a map of email → latest successful charge { amount, currency, date, chargeId }
 */
async function detectPayments(clientEmails, daysSince = 60) {
  const secretKey = await keytar.getPassword(SERVICE_NAME, 'stripe_secret_key')
  if (!secretKey) return {}

  const since = Math.floor(Date.now() / 1000) - daysSince * 86400
  const results = {}

  try {
    // Fetch recent successful PaymentIntents
    const res = await axios.get(`${API_BASE}/payment_intents`, {
      params: {
        limit:    100,
        created: { gte: since },
      },
      auth: { username: secretKey, password: '' }
    })

    const intents = res.data?.data || []

    for (const intent of intents) {
      if (intent.status !== 'succeeded') continue

      // Get customer email from the charge receipt or customer object
      const chargeId = intent.latest_charge
      if (!chargeId) continue

      const chargeRes = await axios.get(`${API_BASE}/charges/${chargeId}`, {
        auth: { username: secretKey, password: '' }
      })
      const charge = chargeRes.data
      const email = charge.billing_details?.email || charge.receipt_email

      if (email && clientEmails.includes(email.toLowerCase())) {
        results[email.toLowerCase()] = {
          chargeId:   chargeId,
          amount:     charge.amount / 100,
          currency:   charge.currency?.toUpperCase(),
          date:       new Date(charge.created * 1000).toISOString(),
          description: charge.description || '',
        }
      }
    }

    log.info(`Stripe: scanned ${intents.length} payment intents, found ${Object.keys(results).length} matches`)
    return results
  } catch (err) {
    log.error('Stripe detectPayments error:', err.response?.data?.error?.message || err.message)
    return {}
  }
}

/**
 * Fetch a single charge by ID.
 */
async function getCharge(chargeId) {
  const secretKey = await keytar.getPassword(SERVICE_NAME, 'stripe_secret_key')
  if (!secretKey) return null

  try {
    const res = await axios.get(`${API_BASE}/charges/${chargeId}`, {
      auth: { username: secretKey, password: '' }
    })
    return res.data
  } catch (err) {
    log.error('Stripe getCharge error:', err.message)
    return null
  }
}

module.exports = { connectStripe, detectPayments, getCharge }
