const { shell } = require('electron')
const keytar = require('../main/keytar-safe')
const http = require('http')
const url = require('url')
const axios = require('axios')
const log = require('electron-log')
const { setSetting, getSetting } = require('../main/db')

const SERVICE_NAME = 'com.collet.app'
const REDIRECT_PORT = 8768
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/xero`
const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize'
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

const SCOPES = 'openid profile email accounting.transactions.read accounting.contacts.read offline_access'

function buildAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID || '',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: Math.random().toString(36).slice(2)
  })
  return `${XERO_AUTH_URL}?${params.toString()}`
}

async function startXeroOAuth() {
  return new Promise((resolve) => {
    const authUrl = buildAuthUrl()

    let server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/xero')) return

      const code = parsedUrl.query.code
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0C0C0C;color:#F0EDE6;font-family:monospace;padding:40px"><p>Xero connected. You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code' })
        return
      }

      try {
        const credentials = Buffer.from(
          `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
        ).toString('base64')

        const tokenRes = await axios.post(XERO_TOKEN_URL, new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI
        }), {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })

        const { access_token, refresh_token } = tokenRes.data

        await keytar.setPassword(SERVICE_NAME, 'xero_access_token', access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'xero_refresh_token', refresh_token)
        }

        const tenantsRes = await axios.get('https://api.xero.com/connections', {
          headers: { 'Authorization': `Bearer ${access_token}` }
        })

        const tenantId = tenantsRes.data[0]?.tenantId
        if (tenantId) setSetting('xero_tenant_id', tenantId)

        log.info(`Xero connected (tenant: ${tenantId})`)
        resolve({ ok: true, tenantId, provider: 'xero' })
      } catch (err) {
        log.error('Xero OAuth error:', err)
        resolve({ ok: false, error: err.message })
      }
    })

    server.listen(REDIRECT_PORT, () => {
      shell.openExternal(authUrl)
    })

    server.on('error', (err) => {
      resolve({ ok: false, error: `OAuth server error: ${err.message}` })
    })

    setTimeout(() => {
      server.close()
      resolve({ ok: false, error: 'OAuth timeout' })
    }, 5 * 60 * 1000)
  })
}

async function getAccessToken() {
  let accessToken = await keytar.getPassword(SERVICE_NAME, 'xero_access_token')
  const refreshToken = await keytar.getPassword(SERVICE_NAME, 'xero_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('Xero not authenticated')

  try {
    await axios.get('https://api.xero.com/connections', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    return accessToken
  } catch {
    if (!refreshToken) throw new Error('Xero token expired')

    const credentials = Buffer.from(
      `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
    ).toString('base64')

    const tokenRes = await axios.post(XERO_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    const newToken = tokenRes.data.access_token
    await keytar.setPassword(SERVICE_NAME, 'xero_access_token', newToken)
    return newToken
  }
}

async function fetchInvoices() {
  const accessToken = await getAccessToken()
  const tenantId = getSetting('xero_tenant_id')

  const res = await axios.get(`${XERO_API_BASE}/Invoices`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-tenant-id': tenantId,
      'Accept': 'application/json'
    },
    params: {
      Statuses: 'AUTHORISED',
      where: 'AmountDue > 0',
      page: 1
    }
  })

  const xeroInvoices = res.data?.Invoices || []

  return xeroInvoices.map(inv => ({
    id: `XERO-${inv.InvoiceID}`,
    client_name: inv.Contact?.Name || 'Unknown',
    client_email: inv.Contact?.EmailAddress || null,
    amount: parseFloat(inv.AmountDue || 0),
    due_date: parseXeroDate(inv.DueDate),
    source: 'xero',
    status: inv.AmountDue > 0 ? 'open' : 'paid'
  })).filter(inv => inv.client_email)
}

function parseXeroDate(xeroDate) {
  if (!xeroDate) return new Date().toISOString().split('T')[0]
  const match = xeroDate.match(/\/Date\((\d+)/)
  if (match) return new Date(parseInt(match[1])).toISOString().split('T')[0]
  return xeroDate
}

module.exports = { startXeroOAuth, fetchInvoices, getAccessToken }
