const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const log = require('electron-log')

log.transports.file.level = 'info'
log.transports.console.level = 'debug'

// Catch ALL unhandled errors in the main process and log them with full stack
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err.message, err.stack)
  console.error('[uncaughtException]', err.message, '\n', err.stack)
})

process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason)
  console.error('[unhandledRejection]', reason)
})

app.setName('Collet')

if (process.platform === 'darwin') {
  app.dock.hide()
}

let tray = null
let setupWindow = null
let logWindow = null
let settingsWindow = null
let isSetupComplete = false

function isSetupDone() {
  try {
    const { getSetting } = require('./db')
    return getSetting('setup_complete') === 'true'
  } catch {
    return false
  }
}

async function checkLicense() {
  const { checkStoredLicense } = require('./license')
  const result = await checkStoredLicense()
  if (!result.valid) {
    openSetupWizard()
    return false
  }
  return true
}

function openSetupWizard() {
  if (setupWindow) {
    setupWindow.focus()
    return
  }

  const { createSetupWindow } = require('../setup/setup-window')
  setupWindow = createSetupWindow()

  setupWindow.on('closed', () => {
    setupWindow = null
    if (isSetupDone()) {
      startBot()
    } else {
      app.quit()
    }
  })
}

function openLogWindow() {
  if (logWindow) {
    logWindow.focus()
    return
  }

  logWindow = new BrowserWindow({
    width: 760,
    height: 520,
    title: 'Collet — Activity Log',
    backgroundColor: '#FFFFFF',
    frame: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  logWindow.loadFile(path.join(__dirname, '../setup/log.html'))
  logWindow.on('closed', () => { logWindow = null })
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 480,
    title: 'Collet — Settings',
    backgroundColor: '#FFFFFF',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  settingsWindow.loadFile(path.join(__dirname, '../setup/settings.html'))
  settingsWindow.on('closed', () => { settingsWindow = null })
}

async function startBot() {
  const { createTray, initPausedState } = require('./tray')
  const { startScheduler } = require('./scheduler')
  const { checkForUpdates, scheduleUpdateCheck, setupUpdater } = require('./updater')
  const { scan } = require('./scanner')

  initPausedState()

  tray = createTray(
    () => {
      const { triggerManualScan } = require('./scheduler')
      triggerManualScan(scan)
    },
    openLogWindow,
    openSettingsWindow,
    () => checkForUpdates()
  )

  setupUpdater(tray)
  scheduleUpdateCheck()
  startScheduler(scan)

  log.info('Collet bot started')

  setTimeout(() => scan(), 3000)
}

app.whenReady().then(async () => {
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })

  // In dev mode, auto-complete setup the first time so the wizard is skipped entirely.
  if (process.env.NODE_ENV === 'development' && !isSetupDone()) {
    const { setSetting } = require('./db')
    setSetting('license_status', 'valid')
    setSetting('license_plan', 'pro')
    setSetting('license_validated_at', new Date().toISOString())
    setSetting('keychain_fallback__license_key', 'DEV-TEST-0000-0000')
    setSetting('email_provider', 'gmail')
    setSetting('email_address', 'dev@example.com')
    setSetting('accounting_source', 'quickbooks')
    setSetting('qb_realm_id', 'dev-realm-123')
    setSetting('scan_frequency', '0 * * * *')
    setSetting('sender_name', 'Accounts Receivable (Dev)')
    setSetting('setup_complete', 'true')
    log.info('[DEV] Auto-completed setup — wizard skipped')
  }

  if (!isSetupDone()) {
    openSetupWizard()
  } else {
    const licenseOk = await checkLicense()
    if (licenseOk) {
      startBot()
    }
  }
})

ipcMain.handle('setup:validate-license', async (_, key) => {
  const { validateLicense } = require('./license')
  return validateLicense(key)
})

ipcMain.handle('setup:save-setting', async (_, key, value) => {
  const { setSetting } = require('./db')
  setSetting(key, value)
  return { ok: true }
})

ipcMain.handle('setup:get-setting', async (_, key) => {
  const { getSetting } = require('./db')
  return getSetting(key)
})

ipcMain.handle('setup:store-credential', async (_, account, password) => {
  const keytar = require('./keytar-safe')
  await keytar.setPassword('com.collet.app', account, password)
  return { ok: true }
})

ipcMain.handle('setup:oauth-gmail', async () => {
  if (process.env.NODE_ENV === 'development') {
    const { setSetting } = require('./db')
    setSetting('email_provider', 'gmail')
    setSetting('email_address', 'dev@example.com')
    return { ok: true, email: 'dev@example.com', provider: 'gmail', dev: true }
  }
  const { startGmailOAuth } = require('../integrations/gmail')
  return startGmailOAuth()
})

ipcMain.handle('setup:oauth-outlook', async () => {
  if (process.env.NODE_ENV === 'development') {
    const { setSetting } = require('./db')
    setSetting('email_provider', 'outlook')
    setSetting('email_address', 'dev@example.com')
    return { ok: true, email: 'dev@example.com', provider: 'outlook', dev: true }
  }
  const { startOutlookOAuth } = require('../integrations/outlook')
  return startOutlookOAuth()
})

ipcMain.handle('setup:oauth-quickbooks', async () => {
  if (process.env.NODE_ENV === 'development') {
    const { setSetting } = require('./db')
    setSetting('accounting_source', 'quickbooks')
    setSetting('qb_realm_id', 'dev-realm-123')
    return { ok: true, realmId: 'dev-realm-123', provider: 'quickbooks', dev: true }
  }
  const { startQuickBooksOAuth } = require('../integrations/quickbooks')
  return startQuickBooksOAuth()
})

ipcMain.handle('setup:oauth-xero', async () => {
  if (process.env.NODE_ENV === 'development') {
    const { setSetting } = require('./db')
    setSetting('accounting_source', 'xero')
    setSetting('xero_tenant_id', 'dev-tenant-123')
    return { ok: true, tenantId: 'dev-tenant-123', provider: 'xero', dev: true }
  }
  const { startXeroOAuth } = require('../integrations/xero')
  return startXeroOAuth()
})

ipcMain.handle('setup:oauth-hubspot', async () => {
  if (process.env.NODE_ENV === 'development') {
    const { setSetting } = require('./db')
    setSetting('crm_source', 'hubspot')
    return { ok: true, provider: 'hubspot', dev: true }
  }
  const { startHubSpotOAuth } = require('../integrations/hubspot')
  return startHubSpotOAuth()
})

ipcMain.handle('setup:complete', async () => {
  const { setSetting } = require('./db')
  setSetting('setup_complete', 'true')
  if (setupWindow) setupWindow.close()
  startBot()
  return { ok: true }
})

ipcMain.handle('log:get-entries', async (_, limit) => {
  const { getSequenceLogs, getStats } = require('./db')
  return { logs: getSequenceLogs(limit || 100), stats: getStats() }
})

ipcMain.handle('settings:get-all', async () => {
  const { getSetting } = require('./db')
  return {
    scan_frequency: getSetting('scan_frequency', '0 * * * *'),
    email_provider: getSetting('email_provider'),
    accounting_source: getSetting('accounting_source'),
    sender_name: getSetting('sender_name'),
    pay_link: getSetting('pay_link')
  }
})

ipcMain.handle('settings:save', async (_, settings) => {
  const { setSetting } = require('./db')
  const { updateFrequency } = require('./scheduler')
  const { scan } = require('./scanner')
  const { resetTransporter } = require('./sender')

  for (const [key, value] of Object.entries(settings)) {
    setSetting(key, value)
  }

  // Invalidate cached nodemailer transporter when email config changes
  if (settings.email_provider !== undefined || settings.email_address !== undefined) {
    resetTransporter()
  }

  if (settings.scan_frequency) {
    updateFrequency(settings.scan_frequency, scan)
  }

  return { ok: true }
})

// Re-authentication handlers accessible from the settings window
ipcMain.handle('settings:reauth-gmail', async () => {
  const { startGmailOAuth } = require('../integrations/gmail')
  return startGmailOAuth()
})

ipcMain.handle('settings:reauth-outlook', async () => {
  const { startOutlookOAuth } = require('../integrations/outlook')
  return startOutlookOAuth()
})

ipcMain.handle('settings:reauth-quickbooks', async () => {
  const { startQuickBooksOAuth } = require('../integrations/quickbooks')
  return startQuickBooksOAuth()
})

ipcMain.handle('settings:reauth-xero', async () => {
  const { startXeroOAuth } = require('../integrations/xero')
  return startXeroOAuth()
})

ipcMain.handle('settings:reauth-hubspot', async () => {
  const { startHubSpotOAuth } = require('../integrations/hubspot')
  return startHubSpotOAuth()
})

ipcMain.handle('shell:open-external', async (_, url) => {
  await shell.openExternal(url)
})

ipcMain.handle('app:get-version', () => app.getVersion())

app.on('before-quit', () => {
  const { stopScheduler } = require('./scheduler')
  stopScheduler()
})
