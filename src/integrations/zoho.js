/**
 * Zoho CRM integration — OAuth 2.0 + CRM updates
 *
 * Required env vars:
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *
 * Used to:
 *   - Find a Contact by email
 *   - Log a Note when a collection email is sent
 *   - Update a Deal stage to Closed Won when invoice is paid
 *
 * Zoho OAuth: https://www.zoho.com/crm/developer/docs/api/v6/oauth-overview.html
 */

const { shell } = require('electron')
const keytar    = require('../main/keytar-safe')
const http      = require('http')
const url       = require('url')
const axios     = require('axios')
const log       = require('electron-log')
const { setSetting, getSetting } = require('../main/db')

const SERVICE_NAME  = 'com.collet.app'
const REDIRECT_PORT = 8772
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/oauth/zoho`
// Zoho datacenter is determined at auth time; we default to .com
const AUTH_URL  = 'https://accounts.zoho.com/oauth/v2/authorize'
const TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const API_BASE  = 'https://www.zohoapis.com/crm/v6'

const SCOPES = 'ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.deals.ALL,ZohoCRM.modules.notes.CREATE'

function buildAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.ZOHO_CLIENT_ID || '',
    scope:         SCOPES,
    redirect_uri:  REDIRECT_URI,
    access_type:   'offline',
  })
  return `${AUTH_URL}?${params.toString()}`
}

async function startZohoOAuth() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/zoho')) return

      const code         = parsedUrl.query.code
      const error        = parsedUrl.query.error
      const location     = parsedUrl.query['accounts-server'] // Zoho datacenter hint

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#fff;color:#111;font-family:Inter,sans-serif;padding:40px"><h2>Zoho CRM connected.</h2><p>You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code received' })
        return
      }

      try {
        const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     process.env.ZOHO_CLIENT_ID,
          client_secret: process.env.ZOHO_CLIENT_SECRET,
          code,
          redirect_uri:  REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

        const { access_token, refresh_token, api_domain } = tokenRes.data

        await keytar.setPassword(SERVICE_NAME, 'zoho_access_token',  access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'zoho_refresh_token', refresh_token)
        }
        // Store the datacenter-specific API domain if provided
        setSetting('zoho_api_domain', api_domain || 'https://www.zohoapis.com')
        setSetting('crm_source', 'zoho')

        log.info('Zoho CRM connected')
        resolve({ ok: true, provider: 'zoho', apiDomain: api_domain })
      } catch (err) {
        log.error('Zoho OAuth error:', err.message)
        resolve({ ok: false, error: err.message })
      }
    })

    server.listen(REDIRECT_PORT, () => shell.openExternal(buildAuthUrl()))
    server.on('error', (err) => resolve({ ok: false, error: `OAuth server error: ${err.message}` }))
    setTimeout(() => { server.close(); resolve({ ok: false, error: 'OAuth timeout' }) }, 5 * 60 * 1000)
  })
}

function getApiBase() {
  const domain = getSetting('zoho_api_domain') || 'https://www.zohoapis.com'
  return `${domain}/crm/v6`
}

async function getAccessToken() {
  let accessToken   = await keytar.getPassword(SERVICE_NAME, 'zoho_access_token')
  const refreshToken  = await keytar.getPassword(SERVICE_NAME, 'zoho_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('Zoho CRM not authenticated')

  try {
    await axios.get(`${getApiBase()}/users?type=CurrentUser`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
    })
    return accessToken
  } catch (err) {
    if (err.response?.status === 401 && refreshToken) {
      const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: refreshToken,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

      const newToken = tokenRes.data.access_token
      await keytar.setPassword(SERVICE_NAME, 'zoho_access_token', newToken)
      return newToken
    }
    throw err
  }
}

/**
 * Find a Contact in Zoho CRM by email.
 * Returns { id, name } or null.
 */
async function findContactByEmail(email) {
  try {
    const accessToken = await getAccessToken()
    const res = await axios.get(
      `${getApiBase()}/Contacts/search?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    )
    const record = res.data?.data?.[0]
    if (!record) return null
    return { id: record.id, name: `${record.First_Name || ''} ${record.Last_Name || ''}`.trim() }
  } catch (err) {
    log.error('Zoho findContactByEmail error:', err.message)
    return null
  }
}

/**
 * Add a Note to a Contact record.
 */
async function logNote({ contactId, title, content }) {
  try {
    const accessToken = await getAccessToken()
    await axios.post(
      `${getApiBase()}/Notes`,
      {
        data: [{
          Note_Title:   title,
          Note_Content: content,
          Parent_Id:    contactId,
          se_module:    'Contacts',
        }]
      },
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    log.info(`Zoho: logged note for contact ${contactId}`)
  } catch (err) {
    log.error('Zoho logNote error:', err.message)
  }
}

/**
 * Find the most recent open Deal linked to a Contact and mark it Closed Won.
 */
async function markDealPaid(contactId) {
  try {
    const accessToken = await getAccessToken()

    // Get Deals linked to this Contact
    const res = await axios.get(
      `${getApiBase()}/Contacts/${contactId}/Deals`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    )
    const deals = res.data?.data || []
    const openDeal = deals.find(d => d.Stage !== 'Closed Won' && d.Stage !== 'Closed Lost')
    if (!openDeal) return

    await axios.put(
      `${getApiBase()}/Deals/${openDeal.id}`,
      { data: [{ Stage: 'Closed Won', Closing_Date: new Date().toISOString().split('T')[0] }] },
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    log.info(`Zoho: Deal ${openDeal.id} marked Closed Won`)
  } catch (err) {
    log.error('Zoho markDealPaid error:', err.message)
  }
}

module.exports = { startZohoOAuth, findContactByEmail, logNote, markDealPaid }
