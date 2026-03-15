/**
 * Salesforce integration — OAuth 2.0 + CRM updates
 *
 * Required env vars:
 *   SALESFORCE_CLIENT_ID
 *   SALESFORCE_CLIENT_SECRET
 *
 * Used to:
 *   - Find a Contact/Lead by email
 *   - Log activity notes (tasks) when emails are sent
 *   - Mark Opportunity as Closed Won when invoice is paid
 *
 * Salesforce OAuth: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm
 */

const { shell }  = require('electron')
const keytar     = require('../main/keytar-safe')
const http       = require('http')
const url        = require('url')
const axios      = require('axios')
const log        = require('electron-log')
const { setSetting, getSetting } = require('../main/db')

const SERVICE_NAME  = 'com.collet.app'
const REDIRECT_PORT = 8771
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/oauth/salesforce`
const AUTH_BASE     = 'https://login.salesforce.com/services/oauth2'

function buildAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.SALESFORCE_CLIENT_ID || '',
    redirect_uri:  REDIRECT_URI,
    scope:         'full refresh_token',
  })
  return `${AUTH_BASE}/authorize?${params.toString()}`
}

async function startSalesforceOAuth() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/salesforce')) return

      const code  = parsedUrl.query.code
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#fff;color:#111;font-family:Inter,sans-serif;padding:40px"><h2>Salesforce connected.</h2><p>You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code received' })
        return
      }

      try {
        const tokenRes = await axios.post(`${AUTH_BASE}/token`, new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          client_id:     process.env.SALESFORCE_CLIENT_ID,
          client_secret: process.env.SALESFORCE_CLIENT_SECRET,
          redirect_uri:  REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

        const { access_token, refresh_token, instance_url } = tokenRes.data

        await keytar.setPassword(SERVICE_NAME, 'sf_access_token',  access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'sf_refresh_token', refresh_token)
        }
        setSetting('sf_instance_url', instance_url)
        setSetting('crm_source', 'salesforce')

        // Fetch connected user info
        const idRes = await axios.get(tokenRes.data.id, {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        const email = idRes.data?.email || ''

        log.info(`Salesforce connected (${email}) at ${instance_url}`)
        resolve({ ok: true, email, provider: 'salesforce', instanceUrl: instance_url })
      } catch (err) {
        log.error('Salesforce OAuth error:', err.message)
        resolve({ ok: false, error: err.message })
      }
    })

    server.listen(REDIRECT_PORT, () => shell.openExternal(buildAuthUrl()))
    server.on('error', (err) => resolve({ ok: false, error: `OAuth server error: ${err.message}` }))
    setTimeout(() => { server.close(); resolve({ ok: false, error: 'OAuth timeout' }) }, 5 * 60 * 1000)
  })
}

async function getAccessToken() {
  let accessToken   = await keytar.getPassword(SERVICE_NAME, 'sf_access_token')
  const refreshToken  = await keytar.getPassword(SERVICE_NAME, 'sf_refresh_token')
  const instanceUrl = getSetting('sf_instance_url')

  if (!instanceUrl) throw new Error('Salesforce not authenticated')

  try {
    await axios.get(`${instanceUrl}/services/data/v59.0/limits`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return { accessToken, instanceUrl }
  } catch (err) {
    if (err.response?.status === 401 && refreshToken) {
      const tokenRes = await axios.post(`${AUTH_BASE}/token`, new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.SALESFORCE_CLIENT_ID,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET,
        refresh_token: refreshToken,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

      const newToken = tokenRes.data.access_token
      await keytar.setPassword(SERVICE_NAME, 'sf_access_token', newToken)
      return { accessToken: newToken, instanceUrl }
    }
    throw err
  }
}

/**
 * Find a Contact or Lead by email address.
 * Returns { id, type: 'Contact'|'Lead', name } or null.
 */
async function findContactByEmail(email) {
  try {
    const { accessToken, instanceUrl } = await getAccessToken()
    const query = encodeURIComponent(
      `SELECT Id, Name, Email FROM Contact WHERE Email = '${email}' LIMIT 1`
    )
    const res = await axios.get(
      `${instanceUrl}/services/data/v59.0/query?q=${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const record = res.data?.records?.[0]
    if (record) return { id: record.Id, type: 'Contact', name: record.Name }

    // Fallback to Lead
    const leadQuery = encodeURIComponent(
      `SELECT Id, Name, Email FROM Lead WHERE Email = '${email}' AND IsConverted = false LIMIT 1`
    )
    const leadRes = await axios.get(
      `${instanceUrl}/services/data/v59.0/query?q=${leadQuery}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const lead = leadRes.data?.records?.[0]
    if (lead) return { id: lead.Id, type: 'Lead', name: lead.Name }

    return null
  } catch (err) {
    log.error('Salesforce findContactByEmail error:', err.message)
    return null
  }
}

/**
 * Log a Task (activity) in Salesforce against a Contact/Lead.
 */
async function logActivity({ whoId, subject, description }) {
  try {
    const { accessToken, instanceUrl } = await getAccessToken()
    await axios.post(
      `${instanceUrl}/services/data/v59.0/sobjects/Task`,
      {
        WhoId:          whoId,
        Subject:        subject,
        Description:    description,
        Status:         'Completed',
        ActivityDate:   new Date().toISOString().split('T')[0],
        TaskSubtype:    'Email',
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    log.info(`Salesforce: logged activity for ${whoId}`)
  } catch (err) {
    log.error('Salesforce logActivity error:', err.message)
  }
}

/**
 * Update the most recent open Opportunity for a Contact to Closed Won.
 */
async function markOpportunityPaid(contactId) {
  try {
    const { accessToken, instanceUrl } = await getAccessToken()
    const query = encodeURIComponent(
      `SELECT Id FROM Opportunity WHERE ContactId = '${contactId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 1`
    )
    const res = await axios.get(
      `${instanceUrl}/services/data/v59.0/query?q=${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const opp = res.data?.records?.[0]
    if (!opp) return

    await axios.patch(
      `${instanceUrl}/services/data/v59.0/sobjects/Opportunity/${opp.Id}`,
      { StageName: 'Closed Won', CloseDate: new Date().toISOString().split('T')[0] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    )
    log.info(`Salesforce: Opportunity ${opp.Id} marked Closed Won`)
  } catch (err) {
    log.error('Salesforce markOpportunityPaid error:', err.message)
  }
}

module.exports = { startSalesforceOAuth, findContactByEmail, logActivity, markOpportunityPaid }
