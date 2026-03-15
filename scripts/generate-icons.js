/**
 * generate-icons.js
 * Pure Node.js (no external deps) PNG generator for Collet icons.
 * Outputs:
 *   assets/tray-icon.png   — 22×22 monochrome template image for macOS tray
 *   assets/icon.png        — 512×512 app icon for electron-builder
 *
 * Run: node scripts/generate-icons.js
 */

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ─── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ─── PNG building ─────────────────────────────────────────────────────────────
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const combined = Buffer.concat([t, data])
  return Buffer.concat([u32(data.length), combined, u32(crc32(combined))])
}

/**
 * @param {Uint8Array} pixels  - flat RGBA bytes, length = width*height*4
 * @param {number}     width
 * @param {number}     height
 */
function buildPNG(pixels, width, height) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = pngChunk('IHDR', Buffer.concat([
    u32(width), u32(height),
    Buffer.from([8, 6, 0, 0, 0]) // 8-bit RGBA
  ]))

  const raw = []
  for (let y = 0; y < height; y++) {
    raw.push(0) // filter byte: None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      raw.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3])
    }
  }

  const idat = pngChunk('IDAT', zlib.deflateSync(Buffer.from(raw), { level: 6 }))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdr, idat, iend])
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────
function createCanvas(w, h) {
  const pixels = new Uint8Array(w * h * 4) // transparent
  return {
    pixels,
    setPixel(x, y, r, g, b, a = 255) {
      if (x < 0 || x >= w || y < 0 || y >= h) return
      const i = (y * w + x) * 4
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a
    },
    fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          this.setPixel(x, y, r, g, b, a)
        }
      }
    },
    // Anti-aliased circle stroke
    circle(cx, cy, outerR, innerR, r, g, b) {
      const x0 = Math.floor(cx - outerR - 1)
      const x1 = Math.ceil(cx + outerR + 1)
      const y0 = Math.floor(cy - outerR - 1)
      const y1 = Math.ceil(cy + outerR + 1)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          if (dist > outerR + 0.5 || dist < innerR - 0.5) continue
          const alpha = Math.min(
            smoothstep(outerR - 0.5, outerR + 0.5, dist),
            1 - smoothstep(innerR - 0.5, innerR + 0.5, dist)
          )
          const a = Math.round(alpha * 255)
          if (a > 0) this.setPixel(x, y, r, g, b, a)
        }
      }
    },
    toPNG() {
      return buildPNG(pixels, w, h)
    }
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// ─── Design: C-letterform ─────────────────────────────────────────────────────
// Draws the Collet "C" — a partial circle ring with a right-side opening.

function drawC(canvas, cx, cy, outerR, innerR, openingDeg, r, g, b) {
  const openRad = (openingDeg / 2) * (Math.PI / 180)
  const x0 = Math.floor(cx - outerR - 1)
  const x1 = Math.ceil(cx + outerR + 1)
  const y0 = Math.floor(cy - outerR - 1)
  const y1 = Math.ceil(cy + outerR + 1)

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > outerR + 0.5 || dist < innerR - 0.5) continue

      // angle: 0 = right, measured clockwise from right
      const angle = Math.atan2(dy, dx)

      // Opening is on the right side: -openRad to +openRad
      if (angle > -openRad && angle < openRad) continue

      const alpha = Math.min(
        smoothstep(outerR - 0.5, outerR + 0.5, dist),
        1 - smoothstep(innerR - 0.5, innerR + 0.5, dist)
      )
      const a = Math.round(alpha * 255)
      if (a > 0) canvas.setPixel(x, y, r, g, b, a)
    }
  }
}

// Add end-caps (rounded tips for the C opening)
function drawEndCap(canvas, cx, cy, capR, r, g, b) {
  const x0 = Math.floor(cx - capR - 1)
  const x1 = Math.ceil(cx + capR + 1)
  const y0 = Math.floor(cy - capR - 1)
  const y1 = Math.ceil(cy + capR + 1)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const alpha = 1 - smoothstep(capR - 0.5, capR + 0.5, dist)
      const a = Math.round(alpha * 255)
      if (a > 0) canvas.setPixel(x, y, r, g, b, a)
    }
  }
}

// ─── Generate tray icon (22×22, black on transparent) ─────────────────────────
function generateTrayIcon() {
  const SIZE = 22
  const c = createCanvas(SIZE, SIZE)
  const cx = SIZE / 2 - 0.5
  const cy = SIZE / 2 - 0.5

  const outerR = 8.5
  const innerR = 5.2
  const opening = 90 // degrees

  drawC(c, cx, cy, outerR, innerR, opening, 0, 0, 0)

  // End-caps
  const mid = (outerR + innerR) / 2
  const capR = (outerR - innerR) / 2
  const openRad = (opening / 2) * (Math.PI / 180)
  drawEndCap(c, cx + mid * Math.cos(-openRad), cy + mid * Math.sin(-openRad), capR, 0, 0, 0)
  drawEndCap(c, cx + mid * Math.cos(openRad),  cy + mid * Math.sin(openRad),  capR, 0, 0, 0)

  return c.toPNG()
}

// ─── Generate app icon (512×512, dark background + red C) ─────────────────────
function generateAppIcon() {
  const SIZE = 512
  const c = createCanvas(SIZE, SIZE)

  // Background: dark square
  c.fillRect(0, 0, SIZE - 1, SIZE - 1, 12, 12, 12, 255)

  const cx = SIZE / 2 - 0.5
  const cy = SIZE / 2 - 0.5
  const outerR = 195
  const innerR = 120
  const opening = 90

  // C stroke — white
  drawC(c, cx, cy, outerR, innerR, opening, 240, 237, 230, 255)

  // End-caps
  const mid = (outerR + innerR) / 2
  const capR = (outerR - innerR) / 2
  const openRad = (opening / 2) * (Math.PI / 180)
  drawEndCap(c, cx + mid * Math.cos(-openRad), cy + mid * Math.sin(-openRad), capR, 240, 237, 230, 255)
  drawEndCap(c, cx + mid * Math.cos(openRad),  cy + mid * Math.sin(openRad),  capR, 240, 237, 230, 255)

  return c.toPNG()
}

// ─── Write files ──────────────────────────────────────────────────────────────
const assetsDir = path.join(__dirname, '../assets')
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })

const trayPNG = generateTrayIcon()
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), trayPNG)
// macOS template image: filename must contain "Template" for auto dark/light adaptation
fs.writeFileSync(path.join(assetsDir, 'tray-iconTemplate.png'), trayPNG)
console.log('✓  assets/tray-icon.png + tray-iconTemplate.png  (22×22)')

const appPNG = generateAppIcon()
fs.writeFileSync(path.join(assetsDir, 'icon.png'), appPNG)
console.log('✓  assets/icon.png  (512×512)')

console.log('\nDone. Run `electron-builder` to convert icon.png → .icns / .ico during build.')
