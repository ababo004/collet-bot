const { BrowserWindow } = require('electron')
const path = require('path')

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    maximizable: false,
    title: 'Collet — Setup',
    backgroundColor: '#0C0C0C',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../main/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  win.loadFile(path.join(__dirname, 'setup.html'))

  // Forward renderer console errors to main process log
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 2) { // 2=warning, 3=error
      const log = require('electron-log')
      log.error(`[renderer:setup line ${line}]`, msg)
      console.error(`[renderer:setup line ${line}]`, msg)
    }
  })

  win.webContents.on('render-process-gone', (e, details) => {
    const log = require('electron-log')
    log.error('[renderer:setup crashed]', details)
    console.error('[renderer:setup crashed]', details)
  })

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.on('close', (e) => {
    const { getSetting } = require('../main/db')
    if (getSetting('setup_complete') !== 'true') {
      const { dialog } = require('electron')
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Quit Collet', 'Continue Setup'],
        defaultId: 1,
        title: 'Setup Incomplete',
        message: 'Setup is not complete.',
        detail: 'Collet cannot run without completing setup. Would you like to continue or quit?'
      })
      if (choice === 0) {
        require('electron').app.quit()
      } else {
        e.preventDefault()
      }
    }
  })

  return win
}

module.exports = { createSetupWindow }
