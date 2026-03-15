const keytar = require('./keytar-safe')
const axios = require('axios')
const log = require('electron-log')
const { setSetting, getSetting } = require('./db')

const SERVICE_NAME = 'com.collet.app'
const PADDLE_VENDOR_ID = process.env.PADDLE_VENDOR_ID || ''
const PADDLE_API_URL = 'https://vendors.paddle.com/api/2.0'

// Keytar wraps macOS Keychain / Windows Credential Manager.
// In development with unsigned apps, Keychain access can fail.
// We always fall back to the DB so setup is never blocked by Keychain.

async function saveLicenseKey(licenseKey) {
  try {
    await keytar.setPassword(SERVICE_NAME, 'license_key', licenseKey)
  } catch (err) {
    log.warn('keytar.setPassword failed (falling back to DB):', err.message)
  }
  // Always persist to DB as a fallback — never relies solely on Keychain
  setSetting('license_key_fallback', licenseKey)
  setSetting('license_key_stored', 'true')
}

async function getLicenseKey() {
  try {
    const key = await keytar.getPassword(SERVICE_NAME, 'license_key')
    if (key) return key
  } catch (err) {
    log.warn('keytar.getPassword failed (falling back to DB):', err.message)
  }
  // Fallback: key stored in DB during previous saveLicenseKey call
  return getSetting('license_key_fallback')
}

async function validateLicense(licenseKey) {
  // Development bypass — any key accepted, no network call needed
  if (process.env.NODE_ENV === 'development') {
    await saveLicenseKey(licenseKey)
    setSetting('license_status', 'valid')
    setSetting('license_plan', 'pro')
    setSetting('license_validated_at', new Date().toISOString())
    return { valid: true, plan: 'pro', dev: true }
  }

  try {
    const response = await axios.post(`${PADDLE_API_URL}/license/activate`, {
      vendor_id: PADDLE_VENDOR_ID,
      vendor_auth_code: process.env.PADDLE_AUTH_CODE || '',
      license_code: licenseKey,
      product_id: process.env.PADDLE_PRODUCT_ID || ''
    }, { timeout: 10000 })

    const data = response.data
    if (data.success && data.response && data.response.activation_successful) {
      await saveLicenseKey(licenseKey)
      setSetting('license_status', 'valid')
      setSetting('license_plan', data.response.license_type || 'starter')
      setSetting('license_validated_at', new Date().toISOString())
      return {
        valid: true,
        plan: data.response.license_type || 'starter',
        activationsLeft: data.response.activations_remaining
      }
    }

    return { valid: false, error: data.error?.message || 'Invalid license key' }
  } catch (err) {
    log.error('License validation error:', err.message)
    return {
      valid: false,
      error: 'Could not connect to license server. Check your internet connection.'
    }
  }
}

async function checkStoredLicense() {
  try {
    const storedKey = await getLicenseKey()
    if (!storedKey) return { valid: false, reason: 'no_key' }

    const lastValidated = getSetting('license_validated_at')
    if (lastValidated) {
      const hoursSince = (Date.now() - new Date(lastValidated).getTime()) / (1000 * 60 * 60)
      if (hoursSince < 24) {
        return {
          valid: true,
          plan: getSetting('license_plan', 'starter'),
          cached: true
        }
      }
    }

    return validateLicense(storedKey)
  } catch (err) {
    log.error('checkStoredLicense error:', err.message)
    return { valid: false, reason: 'error', error: err.message }
  }
}

async function clearLicense() {
  try {
    await keytar.deletePassword(SERVICE_NAME, 'license_key')
  } catch (err) {
    log.warn('keytar.deletePassword failed:', err.message)
  }
  setSetting('license_status', 'none')
  setSetting('license_key_fallback', null)
}

function getPlan() {
  return getSetting('license_plan', 'starter')
}

module.exports = {
  validateLicense,
  checkStoredLicense,
  saveLicenseKey,
  getLicenseKey,
  clearLicense,
  getPlan
}
