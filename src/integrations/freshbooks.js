/**
 * FreshBooks integration — OAuth 2.0 + invoice fetching
 *
 * Required env vars:
 *   FRESHBOOKS_CLIENT_ID
 *   FRESHBOOKS_CLIENT_SECRET
 *
 * FreshBooks API: https://www.freshbooks.com/api/start
 */

const { shell } = require('electron')
const keytar   = require('../main/keytar-safe')
const http     = require('http')
const url      = require('url')
const axios    = require('axios')
const log      = require('electron-log')
const { setSetting, getSetting } = require('../main/db')

const SERVICE_NAME   = 'com.collet.app'
const REDIRECT_PORT  = 8770
const REDIRECT_URI   = `http://localhost:${REDIRECT_PORT}/oauth/freshbooks`
const AUTH_URL       = 'https://auth.freshbooks.com/oauth/authorize'
const TOKEN_URL      = 'https://api.freshbooks.com/auth/oauth/token'
const API_BASE       = 'https://api.freshbooks.com'

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id:     process.env.FRESHBOOKS_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
  })
  return `${AUTH_URL}?${params.toString()}`
}

async function startFreshBooksOAuth() {
  return new Promise((resolve) => {
    const authUrl = buildAuthUrl()

    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/freshbooks')) return

      const code  = parsedUrl.query.code
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#fff;color:#111;font-family:Inter,sans-serif;padding:40px"><h2>FreshBooks connected.</h2><p>You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code received' })
        return
      }

      try {
        const tokenRes = await axios.post(TOKEN_URL, {
          grant_type:    'authorization_code',
          client_id:     process.env.FRESHBOOKS_CLIENT_ID,
          client_secret: process.env.FRESHBOOKS_CLIENT_SECRET,
          code,
          redirect_uri:  REDIRECT_URI,
        })

        const { access_token, refresh_token } = tokenRes.data

        // Fetch the user's account_id (business identifier)
        const meRes = await axios.get(`${API_BASE}/auth/api/v1/users/me`, {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        const accountId = meRes.data?.response?.business_memberships?.[0]?.business?.account_id
          || meRes.data?.response?.id

        await keytar.setPassword(SERVICE_NAME, 'fb_access_token',  access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'fb_refresh_token', refresh_token)
        }
        setSetting('fb_account_id', String(accountId))
        setSetting('accounting_source', 'freshbooks')

        log.info(`FreshBooks connected (account: ${accountId})`)
        resolve({ ok: true, accountId, provider: 'freshbooks' })
      } catch (err) {
        log.error('FreshBooks OAuth error:', err.message)
        resolve({ ok: false, error: err.message })
      }
    })

    server.listen(REDIRECT_PORT, () => shell.openExternal(authUrl))
    server.on('error', (err) => resolve({ ok: false, error: `OAuth server error: ${err.message}` }))
    setTimeout(() => { server.close(); resolve({ ok: false, error: 'OAuth timeout' }) }, 5 * 60 * 1000)
  })
}

async function getAccessToken() {
  let accessToken  = await keytar.getPassword(SERVICE_NAME, 'fb_access_token')
  const refreshToken = await keytar.getPassword(SERVICE_NAME, 'fb_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('FreshBooks not authenticated')

  // Try a lightweight call to validate the token
  try {
    await axios.get(`${API_BASE}/auth/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return accessToken
  } catch (err) {
    if (err.response?.status === 401 && refreshToken) {
      const tokenRes = await axios.post(TOKEN_URL, {
        grant_type:    'refresh_token',
        client_id:     process.env.FRESHBOOKS_CLIENT_ID,
        client_secret: process.env.FRESHBOOKS_CLIENT_SECRET,
        refresh_token: refreshToken,
      })
      const newToken = tokenRes.data.access_token
      await keytar.setPassword(SERVICE_NAME, 'fb_access_token', newToken)
      return newToken
    }
    throw err
  }
}

async function fetchInvoices() {
  const accessToken = await getAccessToken()
  const accountId   = getSetting('fb_account_id')
  if (!accountId) throw new Error('FreshBooks account ID not stored')

  // Fetch outstanding invoices (status 2 = sent/outstanding, 4 = partial)
  const res = await axios.get(
    `${API_BASE}/accounting/account/${accountId}/invoices/invoices`,
    {
      params: { 'search[outstanding]': true, per_page: 100 },
      headers: { Authorization: `Bearer ${accessToken}`, 'Api-Version': 'alpha' }
    }
  )

  const invoices = res.data?.response?.result?.invoices || []

  return invoices.map(inv => ({
    id:           `FB-${inv.id}`,
    client_name:  inv.fname ? `${inv.fname} ${inv.lname}`.trim() : (inv.organization || 'Unknown'),
    client_email: inv.email || null,
    amount:       parseFloat(inv.outstanding?.amount || inv.amount?.amount || 0),
    currency:     inv.outstanding?.code || inv.amount?.code || 'USD',
    due_date:     inv.due_date || inv.create_date,
    source:       'freshbooks',
    status:       'open',
  })).filter(inv => inv.client_email)
}

module.exports = { startFreshBooksOAuth, fetchInvoices, getAccessToken }
