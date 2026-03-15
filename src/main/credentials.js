/**
 * credentials.js — reads integration credentials from process.env first,
 * then falls back to keychain (stored via setup:save-credentials IPC).
 *
 * Usage:
 *   const { getCred } = require('./credentials')
 *   const clientId = await getCred('GOOGLE_CLIENT_ID')
 */

const keytar = require('./keytar-safe')

const SERVICE = 'com.collet.app'

async function getCred(key) {
  if (process.env[key]) return process.env[key]
  const stored = await keytar.getPassword(SERVICE, `cred_${key}`)
  if (stored) process.env[key] = stored  // cache in env for subsequent calls
  return stored || null
}

module.exports = { getCred }
