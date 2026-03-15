const { Tray, Menu, nativeImage, app, shell, dialog } = require('electron')
const path = require('path')
const { getStats, getSetting, setSetting } = require('./db')

let tray = null
let isPaused = false

function createTray(onScanNow, onViewLog, onSettings, onCheckUpdates) {
  // macOS auto-applies template image treatment when filename contains "Template"
  const iconFile = process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png'
  const iconPath = path.join(__dirname, '../../assets', iconFile)
  let icon = nativeImage.createFromPath(iconPath)

  if (icon.isEmpty()) {
    // Fallback to generic icon path if template variant not found
    const fallback = path.join(__dirname, '../../assets/tray-icon.png')
    icon = nativeImage.createFromPath(fallback)
  }

  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 })
  }

  tray = new Tray(icon)
  tray.setToolTip('Collet — AR Automation')

  updateTrayMenu(onScanNow, onViewLog, onSettings, onCheckUpdates)

  setInterval(() => {
    updateTrayMenu(onScanNow, onViewLog, onSettings, onCheckUpdates)
  }, 60000)

  return tray
}

function updateTrayMenu(onScanNow, onViewLog, onSettings, onCheckUpdates) {
  const stats = getStats()
  const lastScan = stats.lastScan
    ? formatRelativeTime(new Date(stats.lastScan))
    : 'Never'

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `COLLET  v${app.getVersion()}`,
      enabled: false,
      click: () => {}
    },
    { type: 'separator' },
    {
      label: `Last scan: ${lastScan}`,
      enabled: false
    },
    {
      label: `${stats.total} invoices tracked`,
      enabled: false
    },
    {
      label: `${stats.active} sequences active`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Scan Now',
      click: onScanNow,
      enabled: !isPaused
    },
    {
      label: 'View Log',
      click: onViewLog
    },
    {
      label: isPaused ? 'Resume' : 'Pause',
      click: () => {
        isPaused = !isPaused
        setSetting('bot_paused', isPaused ? 'true' : 'false')
        updateTrayMenu(onScanNow, onViewLog, onSettings, onCheckUpdates)
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: onSettings
    },
    {
      label: 'Check for Updates',
      click: onCheckUpdates
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ])

  tray.setContextMenu(contextMenu)
}

function formatRelativeTime(date) {
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function setTrayTooltip(message) {
  if (tray) tray.setToolTip(message)
}

function isPausedState() {
  return isPaused
}

function initPausedState() {
  const stored = getSetting('bot_paused', 'false')
  isPaused = stored === 'true'
}

module.exports = { createTray, setTrayTooltip, isPausedState, initPausedState }
