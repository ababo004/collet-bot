const cron = require('node-cron')
const log = require('electron-log')
const { setSetting, getSetting } = require('./db')
const { isPausedState } = require('./tray')

let scanTask = null
let isScanning = false

function startScheduler(scanFn) {
  const frequency = getSetting('scan_frequency', '0 * * * *')
  log.info(`Starting scheduler with cron: ${frequency}`)

  scanTask = cron.schedule(frequency, async () => {
    if (isPausedState()) {
      log.info('Scheduler: bot is paused, skipping scan')
      return
    }
    if (isScanning) {
      log.info('Scheduler: scan already in progress, skipping')
      return
    }

    await runScan(scanFn)
  }, {
    scheduled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  })

  log.info('Scheduler started')
}

async function runScan(scanFn) {
  isScanning = true
  const startTime = Date.now()
  log.info('Scan started')

  try {
    setSetting('last_scan_at', new Date().toISOString())
    await scanFn()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    log.info(`Scan completed in ${elapsed}s`)
  } catch (err) {
    log.error('Scan error:', err)
  } finally {
    isScanning = false
  }
}

function stopScheduler() {
  if (scanTask) {
    scanTask.destroy()
    scanTask = null
    log.info('Scheduler stopped')
  }
}

function updateFrequency(cronExpression, scanFn) {
  stopScheduler()
  setSetting('scan_frequency', cronExpression)
  startScheduler(scanFn)
  log.info(`Scheduler updated: ${cronExpression}`)
}

function triggerManualScan(scanFn) {
  if (isScanning) {
    log.info('Manual scan requested but scan already in progress')
    return Promise.resolve()
  }
  return runScan(scanFn)
}

module.exports = { startScheduler, stopScheduler, updateFrequency, triggerManualScan }
