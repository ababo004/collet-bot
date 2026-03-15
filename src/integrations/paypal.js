/**
 * PayPal integration — Client Credentials OAuth 2.0 + payment detection
 *
 * Required env vars (or stored in keychain after connect):
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *
 * Uses PayPal REST API v2 (not webhook-based — we poll transactions).
 * PayPal API: https://developer.paypal.com/docs/api/overview/
 */

const { shell } = require('electron')
const keytar    = require('../main/keytar-safe')
const http      = require('http')
const url       = require('url')
const axios     = require('axios')
const log       = require('electron-log')
const { setSetting, getSetting } = require('../main/db')

const SERVICE_NAME  = 'com.collet.app'
const REDIRECT_PORT = 8773
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/oauth/paypal`
const SANDBOX       = false  // set to true for sandbox testing

const PP_BASE       = SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'
const PP_AUTH_URL   = SANDBOX
  ? 'https://www.sandbox.paypal.com/signin/authorize'
  : 'https://www.paypal.com/signin/authorize'
const TOKEN_URL     = `${PP_BASE}/v1/oauth2/token`

const SCOPES = 'https://uri.paypal.com/services/payments/realtimepayment https://uri.paypal.com/services/reporting/search/read openid email'

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id:     process.env.PAYPAL_CLIENT_ID || '',
    response_type: 'code',
    scope:         SCOPES,
    redirect_uri:  REDIRECT_URI,
    nonce:         Math.random().toString(36).slice(2),
  })
  return `${PP_AUTH_URL}?${params.toString()}`
}

async function startPayPalOAuth() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/paypal')) return

      const code  = parsedUrl.query.code
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#fff;color:#111;font-family:Inter,sans-serif;padding:40px"><h2>PayPal connected.</h2><p>You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code received' })
        return
      }

      try {
        const credentials = Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
        ).toString('base64')

        const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
        }), {
          headers: {
            Authorization:  `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          }
        })

        const { access_token, refresh_token } = tokenRes.data

        await keytar.setPassword(SERVICE_NAME, 'pp_access_token',  access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'pp_refresh_token', refresh_token)
        }
        setSetting('payment_source', 'paypal')

        // Fetch email from userinfo
        const userRes = await axios.get(`${PP_BASE}/v1/identity/openidconnect/userinfo?schema=openid`, {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        const email = userRes.data?.email || ''

        log.info(`PayPal connected (${email})`)
        resolve({ ok: true, email, provider: 'paypal' })
      } catch (err) {
        log.error('PayPal OAuth error:', err.message)
        resolve({ ok: false, error: err.message })
      }
    })

    server.listen(REDIRECT_PORT, () => shell.openExternal(buildAuthUrl()))
    server.on('error', (err) => resolve({ ok: false, error: `OAuth server error: ${err.message}` }))
    setTimeout(() => { server.close(); resolve({ ok: false, error: 'OAuth timeout' }) }, 5 * 60 * 1000)
  })
}

async function getAccessToken() {
  let accessToken   = await keytar.getPassword(SERVICE_NAME, 'pp_access_token')
  const refreshToken  = await keytar.getPassword(SERVICE_NAME, 'pp_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('PayPal not authenticated')

  try {
    await axios.get(`${PP_BASE}/v1/identity/openidconnect/userinfo?schema=openid`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return accessToken
  } catch (err) {
    if (err.response?.status === 401 && refreshToken) {
      const credentials = Buffer.from(
        `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
      ).toString('base64')

      const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }), {
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      })
      const newToken = tokenRes.data.access_token
      await keytar.setPassword(SERVICE_NAME, 'pp_access_token', newToken)
      return newToken
    }
    throw err
  }
}

/**
 * Search PayPal transactions in the last N days for a set of client emails.
 * Returns a map of email → latest completed payment { amount, currency, date, transactionId }
 */
async function detectPayments(clientEmails, daysSince = 60) {
  const accessToken = await getAccessToken()

  const endDate   = new Date().toISOString()
  const startDate = new Date(Date.now() - daysSince * 86400000).toISOString()

  const results = {}

  try {
    const res = await axios.get(`${PP_BASE}/v1/reporting/transactions`, {
      params: {
        start_date:          startDate,
        end_date:            endDate,
        transaction_status:  'S',    // S = Success
        fields:              'all',
        page_size:           100,
      },
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    const transactions = res.data?.transaction_details || []

    for (const tx of transactions) {
      const payerEmail = tx.payer_info?.email_address?.toLowerCase()
      if (!payerEmail) continue

      if (clientEmails.includes(payerEmail)) {
        const info = tx.transaction_info
        results[payerEmail] = {
          transactionId: info.transaction_id,
          amount:        parseFloat(info.transaction_amount?.value || 0),
          currency:      info.transaction_amount?.currency_code || 'USD',
          date:          info.transaction_initiation_date,
        }
      }
    }

    log.info(`PayPal: scanned ${transactions.length} transactions, found ${Object.keys(results).length} matches`)
    return results
  } catch (err) {
    log.error('PayPal detectPayments error:', err.response?.data?.message || err.message)
    return {}
  }
}

module.exports = { startPayPalOAuth, detectPayments, getAccessToken }
