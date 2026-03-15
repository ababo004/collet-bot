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
  // electron-builder auto-converts icon.png → .icns (macOS) and .ico (Windows)
  // when the platform-specific tools are available (iconutil on macOS, built-in on all).
  // Provide a 512×512 (or ideally 1024×1024) PNG.
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
  win: {
    icon: 'assets/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    installerIcon: 'assets/icon.png',
    uninstallerIcon: 'assets/icon.png'
  },
  publish: {
    provider: 's3',
    bucket: 'collet-releases',
    region: 'us-east-1'
  },
  afterSign: 'scripts/notarize.js'
}
