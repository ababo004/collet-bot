// Renderer uses window.collet (exposed via contextBridge in preload.js)
const api = window.collet

let currentStep = 1
let connectedEmail = null
let connectedAccounting = null
let connectedCRM = null

function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'))
  document.getElementById(`step-${n}`).classList.add('active')
  document.getElementById('step-indicator').textContent = `STEP ${n} / 5`
  currentStep = n
  if (n === 5) updateSummary()
}

function showLoading(msg) {
  const overlay = document.getElementById('loading-overlay')
  document.getElementById('loading-message').textContent = msg
  overlay.classList.add('active')
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active')
}

function showError(id, msg) {
  const el = document.getElementById(id)
  if (el) el.textContent = msg
}

function clearError(id) {
  const el = document.getElementById(id)
  if (el) el.textContent = ''
}

// STEP 1 — License
document.getElementById('validate-license-btn').addEventListener('click', async () => {
  const key = document.getElementById('license-input').value.trim()
  if (!key) { showError('license-error', 'Please enter a license key.'); return }

  showLoading('Validating license key…')
  clearError('license-error')

  try {
    const result = await api.setup.validateLicense(key)
    hideLoading()
    if (result.valid) {
      document.getElementById('license-input').classList.add('success')
      await api.setup.saveSetting('license_plan', result.plan)
      setTimeout(() => showStep(2), 400)
    } else {
      document.getElementById('license-input').classList.add('error')
      showError('license-error', result.error || 'Invalid license key.')
    }
  } catch (err) {
    hideLoading()
    showError('license-error', 'Could not connect. Check your internet connection.')
  }
})

document.getElementById('get-trial-link').addEventListener('click', (e) => {
  e.preventDefault()
  api.openExternal('https://collet.app/pricing')
})

// STEP 2 — Email
async function connectProvider(provider) {
  const btn = document.getElementById(`connect-${provider}`)
  const status = document.getElementById(`${provider}-status`)

  btn.classList.add('connecting')
  btn.disabled = true
  showLoading(`Connecting to ${provider === 'gmail' ? 'Gmail' : 'Outlook'}…`)

  try {
    const result = await (provider === 'gmail' ? api.setup.oauthGmail() : api.setup.oauthOutlook())
    hideLoading()
    if (result.ok) {
      btn.classList.remove('connecting')
      btn.classList.add('connected')
      status.textContent = '[ OK ]'
      connectedEmail = provider
      await api.setup.saveSetting('email_provider', provider)
      await api.setup.saveSetting('email_address', result.email || '')
      document.getElementById('next-2').disabled = false
    } else {
      btn.classList.remove('connecting')
      btn.disabled = false
      showError('email-error', result.error || `Failed to connect to ${provider}.`)
    }
  } catch (err) {
    hideLoading()
    btn.classList.remove('connecting')
    btn.disabled = false
    showError('email-error', `Connection failed: ${err.message}`)
  }
}

document.getElementById('connect-gmail').addEventListener('click', () => connectProvider('gmail'))
document.getElementById('connect-outlook').addEventListener('click', () => connectProvider('outlook'))
document.getElementById('back-1').addEventListener('click', () => showStep(1))
document.getElementById('next-2').addEventListener('click', () => showStep(3))

// STEP 3 — Accounting
async function connectAccounting(provider) {
  const btn = document.getElementById(`connect-${provider}`)
  const status = document.getElementById(`${provider}-status`)

  btn.classList.add('connecting')
  btn.disabled = true
  showLoading(`Connecting to ${provider === 'quickbooks' ? 'QuickBooks' : 'Xero'}…`)

  try {
    const result = await (provider === 'quickbooks' ? api.setup.oauthQuickBooks() : api.setup.oauthXero())
    hideLoading()
    if (result.ok) {
      btn.classList.remove('connecting')
      btn.classList.add('connected')
      status.textContent = '[ OK ]'
      connectedAccounting = provider
      await api.setup.saveSetting('accounting_source', provider)
      document.getElementById('next-3').disabled = false
    } else {
      btn.classList.remove('connecting')
      btn.disabled = false
      showError('accounting-error', result.error || `Failed to connect to ${provider}.`)
    }
  } catch (err) {
    hideLoading()
    btn.classList.remove('connecting')
    btn.disabled = false
    showError('accounting-error', `Connection failed: ${err.message}`)
  }
}

document.getElementById('connect-quickbooks').addEventListener('click', () => connectAccounting('quickbooks'))
document.getElementById('connect-xero').addEventListener('click', () => connectAccounting('xero'))
document.getElementById('back-2').addEventListener('click', () => showStep(2))
document.getElementById('next-3').addEventListener('click', () => showStep(4))

// STEP 4 — CRM
document.getElementById('connect-hubspot').addEventListener('click', async () => {
  const btn = document.getElementById('connect-hubspot')
  const status = document.getElementById('hubspot-status')

  btn.classList.add('connecting')
  btn.disabled = true
  showLoading('Connecting to HubSpot…')

  try {
    const result = await api.setup.oauthHubSpot()
    hideLoading()
    if (result.ok) {
      btn.classList.remove('connecting')
      btn.classList.add('connected')
      status.textContent = '[ OK ]'
      connectedCRM = 'hubspot'
      await api.setup.saveSetting('crm_source', 'hubspot')
    } else {
      btn.classList.remove('connecting')
      btn.disabled = false
      showError('crm-error', result.error || 'Failed to connect to HubSpot.')
    }
  } catch (err) {
    hideLoading()
    btn.classList.remove('connecting')
    btn.disabled = false
    showError('crm-error', `Connection failed: ${err.message}`)
  }
})

document.getElementById('back-3').addEventListener('click', () => showStep(3))
document.getElementById('skip-4').addEventListener('click', () => showStep(5))
document.getElementById('next-4').addEventListener('click', () => showStep(5))

// STEP 5 — Confirm
async function updateSummary() {
  const plan = await api.setup.getSetting('license_plan') || 'VALID'
  document.getElementById('summary-license-val').textContent = `ACTIVE — ${plan.toUpperCase()}`
  document.getElementById('summary-email-val').textContent = connectedEmail
    ? `CONNECTED — ${connectedEmail.toUpperCase()}`
    : 'NOT CONNECTED'
  document.getElementById('summary-accounting-val').textContent = connectedAccounting
    ? `CONNECTED — ${connectedAccounting.toUpperCase()}`
    : 'NOT CONNECTED'
  document.getElementById('summary-crm-val').textContent = connectedCRM
    ? 'CONNECTED — HUBSPOT'
    : 'NOT CONNECTED'
  if (!connectedCRM) {
    document.getElementById('summary-crm-val').classList.add('inactive')
  }
}

document.getElementById('back-4').addEventListener('click', () => showStep(4))

document.getElementById('activate-btn').addEventListener('click', async () => {
  if (!connectedEmail) {
    showError('activate-error', 'Connect an email provider in Step 2 before activating.')
    return
  }
  if (!connectedAccounting) {
    showError('activate-error', 'Connect an accounting source in Step 3 before activating.')
    return
  }
  clearError('activate-error')

  const frequency  = document.getElementById('scan-frequency').value
  const senderName = document.getElementById('sender-name-input').value.trim() || 'Accounts Receivable'
  const payLink    = document.getElementById('pay-link-input').value.trim()

  showLoading('Activating Collet…')

  try {
    await api.setup.saveSetting('scan_frequency', frequency)
    await api.setup.saveSetting('sender_name', senderName)
    if (payLink) await api.setup.saveSetting('pay_link', payLink)
    await new Promise(r => setTimeout(r, 800))
    await api.setup.complete()
  } catch (err) {
    hideLoading()
    showError('activate-error', 'Activation failed. Please try again.')
    console.error('Activation failed:', err)
  }
})
