const { google } = require('googleapis')
const { BrowserWindow, shell } = require('electron')
const keytar = require('../main/keytar-safe')
const http = require('http')
const url = require('url')
const log = require('electron-log')

const SERVICE_NAME = 'com.collet.app'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
]

const REDIRECT_PORT = 8765
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/gmail`

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  )
}

async function startGmailOAuth() {
  return new Promise((resolve) => {
    const oauth2Client = createOAuthClient()
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    })

    let server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true)
      if (!parsedUrl.pathname.startsWith('/oauth/gmail')) return

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
        const { tokens } = await oauth2Client.getToken(code)
        oauth2Client.setCredentials(tokens)

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
        const userInfo = await oauth2.userinfo.get()
        const email = userInfo.data.email

        await keytar.setPassword(SERVICE_NAME, 'gmail_access_token', tokens.access_token)
        if (tokens.refresh_token) {
          await keytar.setPassword(SERVICE_NAME, 'gmail_refresh_token', tokens.refresh_token)
        }

        log.info(`Gmail connected: ${email}`)
        resolve({ ok: true, email, provider: 'gmail' })
      } catch (err) {
        log.error('Gmail OAuth token exchange failed:', err)
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
      resolve({ ok: false, error: 'OAuth timeout — no response received within 5 minutes' })
    }, 5 * 60 * 1000)
  })
}

async function getAuthenticatedClient() {
  const accessToken = await keytar.getPassword(SERVICE_NAME, 'gmail_access_token')
  const refreshToken = await keytar.getPassword(SERVICE_NAME, 'gmail_refresh_token')

  if (!accessToken && !refreshToken) throw new Error('Gmail not authenticated')

  const oauth2Client = createOAuthClient()
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })

  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await keytar.setPassword(SERVICE_NAME, 'gmail_access_token', tokens.access_token)
    }
  })

  return oauth2Client
}

async function searchInboxForPayments(clientEmails, keywords) {
  try {
    const auth = await getAuthenticatedClient()
    const gmail = google.gmail({ version: 'v1', auth })

    const keywordQuery = keywords.map(k => `"${k}"`).join(' OR ')
    const emailQuery = clientEmails.slice(0, 10).map(e => `from:${e}`).join(' OR ')
    const query = `(${keywordQuery}) (${emailQuery}) newer_than:30d`

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50
    })

    const messages = listRes.data.messages || []
    const results = []

    for (const msg of messages.slice(0, 20)) {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      })

      const headers = msgRes.data.payload.headers
      const from = headers.find(h => h.name === 'From')?.value || ''
      const subject = headers.find(h => h.name === 'Subject')?.value || ''
      const snippet = msgRes.data.snippet || ''

      results.push({ from, subject, body: snippet, id: msg.id })
    }

    return results
  } catch (err) {
    log.error('Gmail inbox scan failed:', err.message)
    return []
  }
}

module.exports = { startGmailOAuth, searchInboxForPayments, getAuthenticatedClient }
