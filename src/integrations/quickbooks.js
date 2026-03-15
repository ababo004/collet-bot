const { shell } = require('electron')
const keytar = require('../main/keytar-safe')
const http = require('http')
const url = require('url')
const axios = require('axios')
const log = require('electron-log')
const { setSetting, getSetting } = require('../main/db')

const SERVICE_NAME = 'com.collet.app'
const REDIRECT_PORT = 8767
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/quickbooks`
const QB_BASE = 'https://appcenter.intuit.com/connect/oauth2'
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QB_API_BASE = 'https://quickbooks.api.intuit.com/v3/company'

const SCOPES = 'com.intuit.quickbooks.accounting'

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID || '',
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: Math.random().toString(36).slice(2)
  })
  return `${QB_BASE}?${params.toString()}`
}

async function startQuickBooksOAuth() {
  return new Promise((resolve) => {
    const authUrl = buildAuthUrl()

    let server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/quickbooks')) return

      const code = parsedUrl.query.code
      const realmId = parsedUrl.query.realmId
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0C0C0C;color:#F0EDE6;font-family:monospace;padding:40px"><p>QuickBooks connected. You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code received' })
        return
      }

      try {
        const credentials = Buffer.from(
          `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
        ).toString('base64')

        const tokenRes = await axios.post(QB_TOKEN_URL, new URLSearchParams({
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        }), {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })

        const { access_token, refresh_token } = tokenRes.data

        await keytar.setPassword(SERVICE_NAME, 'qb_access_token', access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'qb_refresh_token', refresh_token)
        }
        setSetting('qb_realm_id', realmId)

        log.info(`QuickBooks connected (realm: ${realmId})`)
        resolve({ ok: true, realmId, provider: 'quickbooks' })
      } catch (err) {
        log.error('QuickBooks OAuth error:', err)
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
  let accessToken = await keytar.getPassword(SERVICE_NAME, 'qb_access_token')
  const refreshToken = await keytar.getPassword(SERVICE_NAME, 'qb_refresh_token')
  const realmId = getSetting('qb_realm_id')

  if (!accessToken && !refreshToken) throw new Error('QuickBooks not authenticated')

  try {
    await axios.get(`${QB_API_BASE}/${realmId}/companyinfo/${realmId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })
    return accessToken
  } catch (err) {
    if (err.response?.status === 401 && refreshToken) {
      const credentials = Buffer.from(
        `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
      ).toString('base64')

      const tokenRes = await axios.post(QB_TOKEN_URL, new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }), {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      const newToken = tokenRes.data.access_token
      await keytar.setPassword(SERVICE_NAME, 'qb_access_token', newToken)
      return newToken
    }
    throw err
  }
}

async function fetchInvoices() {
  const accessToken = await getAccessToken()
  const realmId = getSetting('qb_realm_id')

  const minorVersion = '65'
  // QBO SQL does not have a TxnStatus field — filter on Balance > 0 to get unpaid invoices
  const query = encodeURIComponent(
    `SELECT * FROM Invoice WHERE Balance > '0.00' MAXRESULTS 100`
  )

  const res = await axios.get(
    `${QB_API_BASE}/${realmId}/query?query=${query}&minorversion=${minorVersion}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    }
  )

  const qbInvoices = res.data?.QueryResponse?.Invoice || []

  return qbInvoices.map(inv => ({
    id: `QB-${inv.Id}`,
    client_name: inv.CustomerRef?.name || 'Unknown',
    client_email: extractEmail(inv),
    amount: parseFloat(inv.Balance || 0),
    due_date: inv.DueDate || inv.TxnDate,
    source: 'quickbooks',
    status: inv.Balance > 0 ? 'open' : 'paid'
  })).filter(inv => inv.client_email)
}

function extractEmail(inv) {
  if (inv.BillEmail?.Address) return inv.BillEmail.Address
  if (inv.DeliveryInfo?.DeliveryType === 'Email') return inv.DeliveryInfo?.DeliveryTime
  return null
}

module.exports = { startQuickBooksOAuth, fetchInvoices, getAccessToken }
