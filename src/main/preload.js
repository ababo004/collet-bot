const { contextBridge, ipcRenderer } = require('electron')

/**
 * Exposes a safe, typed API to renderer processes via contextBridge.
 * Renderer code accesses this as window.collet.*
 * No direct Node.js or Electron access is granted to the renderer.
 */
contextBridge.exposeInMainWorld('collet', {
  // Setup wizard
  setup: {
    validateLicense: (key) =>
      ipcRenderer.invoke('setup:validate-license', key),
    saveSetting: (key, value) =>
      ipcRenderer.invoke('setup:save-setting', key, value),
    getSetting: (key) =>
      ipcRenderer.invoke('setup:get-setting', key),
    storeCredential: (account, password) =>
      ipcRenderer.invoke('setup:store-credential', account, password),
    oauthGmail: () =>
      ipcRenderer.invoke('setup:oauth-gmail'),
    oauthOutlook: () =>
      ipcRenderer.invoke('setup:oauth-outlook'),
    oauthQuickBooks: () =>
      ipcRenderer.invoke('setup:oauth-quickbooks'),
    oauthXero: () =>
      ipcRenderer.invoke('setup:oauth-xero'),
    oauthHubSpot: () =>
      ipcRenderer.invoke('setup:oauth-hubspot'),
    complete: () =>
      ipcRenderer.invoke('setup:complete'),
  },

  // Activity log window
  log: {
    getEntries: (limit) =>
      ipcRenderer.invoke('log:get-entries', limit),
  },

  // Settings window
  settings: {
    getAll: () =>
      ipcRenderer.invoke('settings:get-all'),
    save: (settings) =>
      ipcRenderer.invoke('settings:save', settings),
    reauthGmail: () =>
      ipcRenderer.invoke('settings:reauth-gmail'),
    reauthOutlook: () =>
      ipcRenderer.invoke('settings:reauth-outlook'),
    reauthQuickBooks: () =>
      ipcRenderer.invoke('settings:reauth-quickbooks'),
    reauthXero: () =>
      ipcRenderer.invoke('settings:reauth-xero'),
    reauthHubSpot: () =>
      ipcRenderer.invoke('settings:reauth-hubspot'),
  },

  // Open external URLs safely
  openExternal: (url) => {
    const allowed = [
      'https://collet.app',
      'https://paddle.com',
      'https://accounts.google.com',
      'https://login.microsoftonline.com',
      'https://appcenter.intuit.com',
      'https://login.xero.com',
      'https://app.hubspot.com',
    ]
    const isAllowed = allowed.some(origin => url.startsWith(origin))
    if (isAllowed) {
      ipcRenderer.invoke('shell:open-external', url)
    }
  },

  // App version
  getVersion: () => ipcRenderer.invoke('app:get-version'),
})
