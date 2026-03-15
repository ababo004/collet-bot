const { autoUpdater } = require('electron-updater')
const { dialog, BrowserWindow } = require('electron')
const log = require('electron-log')

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'
autoUpdater.autoDownload = false

function setupUpdater(tray) {
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version)
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Collet v${info.version} is available.`,
      detail: 'Would you like to download and install it now?',
      buttons: ['Download & Install', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate()
      }
    })
  })

  autoUpdater.on('update-not-available', () => {
    log.info('No updates available.')
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`Download progress: ${Math.round(progress.percent)}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version)
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Collet v${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart Collet.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
  })
}

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch(err => {
    log.error('Check for updates failed:', err)
  })
}

function scheduleUpdateCheck() {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000
  setTimeout(() => {
    checkForUpdates()
    setInterval(checkForUpdates, TWELVE_HOURS)
  }, 5000)
}

module.exports = { setupUpdater, checkForUpdates, scheduleUpdateCheck }
