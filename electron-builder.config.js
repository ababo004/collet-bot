module.exports = {
  appId: 'com.collet.app',
  productName: 'Collet',
  copyright: 'Copyright © 2025 Collet',
  directories: { output: 'dist' },
  files: [
    'src/**/*',
    'assets/**/*',
    'node_modules/**/*',
    'package.json'
  ],

  // ── macOS ──────────────────────────────────────────────────────────────
  mac: {
    category: 'public.app-category.finance',
    icon: 'assets/icon.png',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  },

  dmg: {
    title: 'Collet ${version}',
    background: 'assets/dmg-background.png',
    icon: 'assets/icon.png',
    iconSize: 100,
    contents: [
      { x: 380, y: 180, type: 'link', path: '/Applications' },
      { x: 130, y: 180, type: 'file' }
    ],
    window: { width: 540, height: 380 }
  },

  // ── Windows ────────────────────────────────────────────────────────────
  win: {
    icon: 'assets/icon.png',
    target: [
      { target: 'nsis',    arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    // Publish metadata so auto-updater works
    artifactName: 'Collet-Setup-${version}.${ext}',
    requestedExecutionLevel: 'asInvoker'
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Collet',
    installerIcon: 'assets/icon.png',
    uninstallerIcon: 'assets/icon.png',
    installerHeader: 'assets/icon.png',
    license: 'LICENSE',
    artifactName: 'Collet-Setup-${version}.${ext}',
    deleteAppDataOnUninstall: false
  },

  // ── Linux (future) ──────────────────────────────────────────────────────
  linux: {
    icon: 'assets/icon.png',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb',      arch: ['x64'] }
    ],
    category: 'Finance',
    description: 'Autonomous accounts receivable desktop bot'
  },

  // ── Publish to GitHub Releases ─────────────────────────────────────────
  publish: {
    provider: 'github',
    owner: 'ababo004',
    repo: 'collet-bot',
    releaseType: 'release'
  },

  afterSign: 'scripts/notarize.js'
}
