const { shell } = require('electron')
const keytar = require('../main/keytar-safe')
const http = require('http')
const url = require('url')
const axios = require('axios')
const log = require('electron-log')

const SERVICE_NAME = 'com.collet.app'
const REDIRECT_PORT = 8769
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/hubspot`
const HS_AUTH_URL = 'https://app.hubspot.com/oauth/authorize'
const HS_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'
const HS_API_BASE = 'https://api.hubapi.com'

const SCOPES = 'crm.objects.contacts.read crm.objects.companies.read'

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID || '',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    optional_scope: 'crm.objects.deals.read'
  })
  return `${HS_AUTH_URL}?${params.toString()}`
}

async function startHubSpotOAuth() {
  return new Promise((resolve) => {
    const authUrl = buildAuthUrl()

    let server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/hubspot')) return

      const code = parsedUrl.query.code
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0C0C0C;color:#F0EDE6;font-family:monospace;padding:40px"><p>HubSpot connected. You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code' })
        return
      }

      try {
        const tokenRes = await axios.post(HS_TOKEN_URL, new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.HUBSPOT_CLIENT_ID || '',
          client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
          redirect_uri: REDIRECT_URI,
          code
        }), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })

        const { access_token, refresh_token } = tokenRes.data

        await keytar.setPassword(SERVICE_NAME, 'hubspot_access_token', access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'hubspot_refresh_token', refresh_token)
        }

        log.info('HubSpot connected')
        resolve({ ok: true, provider: 'hubspot' })
      } catch (err) {
        log.error('HubSpot OAuth error:', err)
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
  let accessToken = await keytar.getPassword(SERVICE_NAME, 'hubspot_access_token')
  const refreshToken = await keytar.getPassword(SERVICE_NAME, 'hubspot_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('HubSpot not authenticated')

  try {
    await axios.get(`${HS_API_BASE}/oauth/v1/access-tokens/${accessToken}`)
    return accessToken
  } catch {
    if (!refreshToken) throw new Error('HubSpot token expired')

    const tokenRes = await axios.post(HS_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID || '',
      client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
      refresh_token: refreshToken
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    const newToken = tokenRes.data.access_token
    await keytar.setPassword(SERVICE_NAME, 'hubspot_access_token', newToken)
    return newToken
  }
}

async function getContactByEmail(email) {
  try {
    const accessToken = await getAccessToken()

    const res = await axios.post(
      `${HS_API_BASE}/crm/v3/objects/contacts/search`,
      {
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: 'EQ',
            value: email
          }]
        }],
        properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'phone']
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    const contact = res.data?.results?.[0]
    if (!contact) return null

    const props = contact.properties
    return {
      id: contact.id,
      email: props.email,
      firstName: props.firstname || '',
      lastName: props.lastname || '',
      company: props.company || '',
      jobTitle: props.jobtitle || '',
      fullName: `${props.firstname || ''} ${props.lastname || ''}`.trim()
    }
  } catch (err) {
    log.error('HubSpot contact lookup failed:', err.message)
    return null
  }
}

async function updateContactPaymentStatus(email, invoiceId, status) {
  try {
    const contact = await getContactByEmail(email)
    if (!contact) return

    const accessToken = await getAccessToken()
    await axios.patch(
      `${HS_API_BASE}/crm/v3/objects/contacts/${contact.id}`,
      {
        properties: {
          [`collet_invoice_${invoiceId}_status`]: status,
          [`collet_last_action`]: new Date().toISOString()
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (err) {
    log.error('HubSpot status update failed:', err.message)
  }
}

module.exports = { startHubSpotOAuth, getContactByEmail, updateContactPaymentStatus, getAccessToken }
