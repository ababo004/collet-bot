/**
 * keytar-safe.js
 *
 * Safe wrappers around keytar that never throw.
 * On macOS, unsigned dev builds can get "Bad method call" from the Security
 * framework — all Keychain errors are caught and logged, and a plain-DB
 * fallback is used when available.
 */

const keytar = require('keytar')
const log    = require('electron-log')
const { getSetting, setSetting } = require('./db')

const DB_PREFIX = 'keychain_fallback__'

async function setPassword(service, account, password) {
  const fallbackKey = `${DB_PREFIX}${account}`
  try {
    await keytar.setPassword(service, account, password)
  } catch (err) {
    log.warn(`[keytar] setPassword(${account}) failed — using DB fallback:`, err.message)
  }
  // Always write a DB copy so the app can function if Keychain is inaccessible
  setSetting(fallbackKey, password)
}

async function getPassword(service, account) {
  const fallbackKey = `${DB_PREFIX}${account}`
  try {
    const val = await keytar.getPassword(service, account)
    if (val !== null && val !== undefined) return val
  } catch (err) {
    log.warn(`[keytar] getPassword(${account}) failed — using DB fallback:`, err.message)
  }
  return getSetting(fallbackKey)
}

async function deletePassword(service, account) {
  const fallbackKey = `${DB_PREFIX}${account}`
  try {
    await keytar.deletePassword(service, account)
  } catch (err) {
    log.warn(`[keytar] deletePassword(${account}) failed:`, err.message)
  }
  setSetting(fallbackKey, null)
}

module.exports = { setPassword, getPassword, deletePassword }
