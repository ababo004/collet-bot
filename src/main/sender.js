const nodemailer = require('nodemailer')
const keytar = require('./keytar-safe')
const log = require('electron-log')
const { getSetting } = require('./db')

const SERVICE_NAME = 'com.collet.app'
let transporter = null

async function getTransporter() {
  if (transporter) return transporter

  const provider = getSetting('email_provider')
  const emailAddress = getSetting('email_address')

  if (provider === 'gmail') {
    const accessToken = await keytar.getPassword(SERVICE_NAME, 'gmail_access_token')
    const refreshToken = await keytar.getPassword(SERVICE_NAME, 'gmail_refresh_token')

    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: emailAddress,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken,
        accessToken
      }
    })
  } else if (provider === 'outlook') {
    const accessToken = await keytar.getPassword(SERVICE_NAME, 'outlook_access_token')
    const refreshToken = await keytar.getPassword(SERVICE_NAME, 'outlook_refresh_token')

    transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        type: 'OAuth2',
        user: emailAddress,
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        refreshToken,
        accessToken
      }
    })
  } else {
    throw new Error('No email provider configured')
  }

  return transporter
}

async function sendEmail({ to, subject, html, text, attachments = [] }) {
  // In dev mode, log the email instead of actually sending it
  if (process.env.NODE_ENV === 'development') {
    log.info(`[DEV] Email (not sent) → To: ${to} | Subject: ${subject}`)
    return { messageId: `dev-${Date.now()}@collet.dev`, dev: true }
  }

  const transport = await getTransporter()
  const fromName = getSetting('sender_name', 'Accounts Receivable')
  const fromEmail = getSetting('email_address')

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    html,
    text,
    attachments
  }

  const result = await transport.sendMail(mailOptions)
  log.info(`Email sent: ${result.messageId} to ${to}`)
  return result
}

async function verifyConnection() {
  try {
    const transport = await getTransporter()
    await transport.verify()
    return { ok: true }
  } catch (err) {
    transporter = null
    return { ok: false, error: err.message }
  }
}

function resetTransporter() {
  transporter = null
}

module.exports = { sendEmail, verifyConnection, resetTransporter }
