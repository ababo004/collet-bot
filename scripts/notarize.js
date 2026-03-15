/**
 * notarize.js — electron-builder afterSign hook
 *
 * Notarizes the macOS app with Apple's notary service.
 * Requires environment variables:
 *   APPLE_ID                    — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID               — your 10-character Apple Developer Team ID
 *
 * If any of these are missing (e.g. local builds / CI without signing),
 * the step is skipped gracefully — the build will still succeed.
 *
 * Install dep: npm install --save-dev @electron/notarize
 */

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context

  if (electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.')
    return
  }

  let notarize
  try {
    notarize = require('@electron/notarize').notarize
  } catch {
    console.warn('[notarize] @electron/notarize not installed — skipping.')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[notarize] Notarizing ${appPath}…`)

  await notarize({
    appBundleId: 'com.collet.app',
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  })

  console.log('[notarize] Done.')
}
