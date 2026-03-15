const { shell } = require('electron')
const keytar = require('../main/keytar-safe')
const http = require('http')
const url = require('url')
const axios = require('axios')
const log = require('electron-log')

const SERVICE_NAME = 'com.collet.app'
const REDIRECT_PORT = 8766
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/outlook`
const TENANT = 'common'
const SCOPES = 'offline_access Mail.ReadWrite Mail.Send User.Read'

const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    prompt: 'select_account'
  })
  return `${AUTH_URL}?${params.toString()}`
}

async function startOutlookOAuth() {
  return new Promise((resolve) => {
    const authUrl = buildAuthUrl()

    let server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/outlook')) return

      const code = parsedUrl.query.code
      const error = parsedUrl.query.error

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0C0C0C;color:#F0EDE6;font-family:monospace;padding:40px"><p>Connected. You can close this window.</p></body></html>')
      server.close()

      if (error || !code) {
        resolve({ ok: false, error: error || 'No authorization code received' })
        return
      }

      try {
        const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID || '',
          client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        }), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })

        const { access_token, refresh_token } = tokenRes.data

        const userRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${access_token}` }
        })

        const email = userRes.data.mail || userRes.data.userPrincipalName

        await keytar.setPassword(SERVICE_NAME, 'outlook_access_token', access_token)
        if (refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'outlook_refresh_token', refresh_token)
        }

        log.info(`Outlook connected: ${email}`)
        resolve({ ok: true, email, provider: 'outlook' })
      } catch (err) {
        log.error('Outlook OAuth token exchange failed:', err)
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
  let accessToken = await keytar.getPassword(SERVICE_NAME, 'outlook_access_token')
  const refreshToken = await keytar.getPassword(SERVICE_NAME, 'outlook_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('Outlook not authenticated')

  try {
    const testRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return accessToken
  } catch {
    if (!refreshToken) throw new Error('Outlook token expired and no refresh token available')

    const tokenRes = await axios.post(TOKEN_URL, new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || '',
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    const newToken = tokenRes.data.access_token
    await keytar.setPassword(SERVICE_NAME, 'outlook_access_token', newToken)
    return newToken
  }
}

async function searchInboxForPayments(clientEmails, keywords) {
  // Graph API does not allow $filter and $search on the same request.
  // Strategy: filter by sender per client email, fetch recent messages,
  // then check subject + bodyPreview for payment keywords client-side.
  try {
    const accessToken = await getAccessToken()
    const results = []

    for (const clientEmail of clientEmails.slice(0, 20)) {
      try {
        const res = await axios.get('https://graph.microsoft.com/v1.0/me/messages', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            $filter: `from/emailAddress/address eq '${clientEmail}'`,
            $orderby: 'receivedDateTime desc',
            $top: 15,
            $select: 'id,from,subject,bodyPreview,receivedDateTime'
          }
        })

        const messages = res.data.value || []
        for (const msg of messages) {
          const text = `${msg.subject || ''} ${msg.bodyPreview || ''}`.toLowerCase()
          const hasKeyword = keywords.some(kw => text.includes(kw.toLowerCase()))
          if (hasKeyword) {
            results.push({
              from: msg.from?.emailAddress?.address || '',
              subject: msg.subject || '',
              body: msg.bodyPreview || '',
              id: msg.id
            })
          }
        }
      } catch (innerErr) {
        log.warn(`Outlook scan skipped for ${clientEmail}: ${innerErr.message}`)
      }
    }

    return results
  } catch (err) {
    log.error('Outlook inbox scan failed:', err.message)
    return []
  }
}

module.exports = { startOutlookOAuth, searchInboxForPayments, getAccessToken }
