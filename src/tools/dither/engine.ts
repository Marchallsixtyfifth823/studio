import type { DitherCell } from "./types"

// ============================================================
// Bayer matrices
// ============================================================

const BAYER: Record<number, number[][]> = {
  2: [
    [0, 2],
    [3, 1],
  ],
  4: [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ],
  8: (() => {
    const b4 = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]
    const m = Array.from({ length: 8 }, () => new Array<number>(8))
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const bx = x % 4,
          by = y % 4
        const quad = (y < 4 ? 0 : 2) + (x < 4 ? 0 : 1)
        const offsets = [0, 2, 3, 1]
        m[y][x] = 4 * b4[by][bx] + offsets[quad]
      }
    }
    return m
  })(),
}

const BAYER_NORM: Record<number, number[][]> = {}
for (const [size, matrix] of Object.entries(BAYER)) {
  const n = parseInt(size)
  const max = n * n
  BAYER_NORM[n] = matrix.map((row) => row.map((v) => (v + 0.5) / max))
}

// ============================================================
// Pattern thresholds
// ============================================================

function getPatternThreshold(
  pattern: string,
  x: number,
  y: number,
  cellSize: number,
): number {
  const n = parseInt(pattern.replace("bayer", ""))
  if (BAYER_NORM[n]) {
    return BAYER_NORM[n][y % n][x % n]
  }

  const nx = (x % cellSize) / cellSize
  const ny = (y % cellSize) / cellSize
  const cx = 0.5,
    cy = 0.5

  switch (pattern) {
    case "halftone": {
      const dx = nx - cx,
        dy = ny - cy
      return Math.sqrt(dx * dx + dy * dy) * 1.414
    }
    case "lines":
      return ny
    case "crosses": {
      const distX = Math.abs(nx - cx)
      const distY = Math.abs(ny - cy)
      return Math.min(distX, distY) * 2
    }
    case "dots": {
      const dx = nx - cx,
        dy = ny - cy
      return Math.sqrt(dx * dx + dy * dy) * 1.414
    }
    case "grid": {
      const distX = Math.abs(nx - cx)
      const distY = Math.abs(ny - cy)
      return Math.max(distX, distY) * 2
    }
    case "scales": {
      const sx = (nx * 2) % 1
      const sy = (ny * 2) % 1
      const dx = sx - 0.5,
        dy = sy - 0.5
      return Math.sqrt(dx * dx + dy * dy) * 1.414
    }
    default:
      return 0.5
  }
}

// ============================================================
// Gradient generation
// ============================================================

function pseudoNoise(x: number, y: number): number {
  let n = x * 374761393 + y * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  n = n ^ (n >> 16)
  return (n & 0x7fffffff) / 0x7fffffff
}

export function generateGradientGrid(
  type: string,
  size: number,
  cellSize: number,
  height: number,
  angle: number,
): { grid: number[][]; cols: number; rows: number } {
  const cols = Math.ceil(size / cellSize)
  const rows = Math.ceil((height || size) / cellSize)
  const angleRad = ((angle || 0) * Math.PI) / 180

  const grid = new Array<number[]>(rows)
  for (let gy = 0; gy < rows; gy++) {
    grid[gy] = new Array<number>(cols)
    for (let gx = 0; gx < cols; gx++) {
      const nx = gx / (cols - 1 || 1)
      const ny = gy / (rows - 1 || 1)

      let lum: number
      switch (type) {
        case "linear": {
          const raw = nx * Math.cos(angleRad) + ny * Math.sin(angleRad)
          const maxProj =
            Math.abs(Math.cos(angleRad)) + Math.abs(Math.sin(angleRad))
          lum = maxProj > 0 ? raw / maxProj : 0
          break
        }
        case "radial": {
          const dx = nx - 0.5,
            dy = ny - 0.5
          lum = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2)
          break
        }
        case "conic": {
          const a = Math.atan2(ny - 0.5, nx - 0.5) + angleRad
          lum = ((a + Math.PI) % (2 * Math.PI)) / (2 * Math.PI)
          break
        }
        case "noise":
          lum = pseudoNoise(gx, gy)
          break
        default:
          lum = nx
      }
      grid[gy][gx] = lum
    }
  }

  return { grid, cols, rows }
}

// ============================================================
// Dithering core
// ============================================================

function mapToColor(
  brightness: number,
  palette: string[],
  percentages: number[],
): { index: number } {
  const n = palette.length
  const cumulative: number[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += percentages[i]
    cumulative.push(sum / 100)
  }

  for (let i = 0; i < n; i++) {
    if (brightness <= cumulative[i]) {
      return { index: i }
    }
  }
  return { index: n - 1 }
}

export function ditherImage(
  luminanceGrid: number[][],
  cols: number,
  rows: number,
  settings: {
    pattern: string
    mode: string
    style: string
    cellSize: number
    angle: number
    scale: number
    offsetX: number
    offsetY: number
    palette: string[]
    percentages: number[]
  },
): DitherCell[][] {
  const {
    pattern,
    mode,
    style,
    cellSize,
    angle,
    scale: radialScale,
    offsetX,
    offsetY,
    palette,
    percentages,
  } = settings

  const result = new Array<DitherCell[]>(rows)
  const angleRad = (angle * Math.PI) / 180

  for (let y = 0; y < rows; y++) {
    result[y] = new Array<DitherCell>(cols)
    for (let x = 0; x < cols; x++) {
      let brightness = luminanceGrid[y][x]

      const nx = x / cols
      const ny = y / rows

      if (mode === "linear") {
        const gradient = nx * Math.cos(angleRad) + ny * Math.sin(angleRad)
        brightness = brightness * 0.7 + gradient * 0.3
        brightness = Math.max(0, Math.min(1, brightness))
      } else if (mode === "radial") {
        const ox = offsetX / 100
        const oy = offsetY / 100
        const dx = nx - (0.5 + ox)
        const dy = ny - (0.5 + oy)
        const dist = Math.sqrt(dx * dx + dy * dy) * (radialScale / 100) * 2
        brightness = brightness * 0.7 + dist * 0.3
        brightness = Math.max(0, Math.min(1, brightness))
      }

      if (style === "scaled") {
        const colorInfo = mapToColor(brightness, palette, percentages)
        result[y][x] = { colorIndex: colorInfo.index, size: 1 - brightness }
      } else {
        let threshold: number
        if (pattern.startsWith("bayer")) {
          const n = parseInt(pattern.replace("bayer", ""))
          threshold = BAYER_NORM[n][y % n][x % n]
        } else {
          threshold = getPatternThreshold(
            pattern,
            x,
            y,
            Math.max(2, Math.floor(cellSize / 2)),
          )
        }
        const adjusted = brightness + (threshold - 0.5) * 0.5
        const colorInfo = mapToColor(
          Math.max(0, Math.min(1, adjusted)),
          palette,
          percentages,
        )
        result[y][x] = { colorIndex: colorInfo.index, size: 1.0 }
      }
    }
  }

  return result
}

// ============================================================
// Image processing
// ============================================================

export function processImageToGrid(
  image: HTMLImageElement,
  cellSize: number,
): { grid: number[][]; cols: number; rows: number } {
  const cols = Math.ceil(image.width / cellSize)
  const rows = Math.ceil(image.height / cellSize)

  const tmpCanvas = document.createElement("canvas")
  tmpCanvas.width = image.width
  tmpCanvas.height = image.height
  const ctx = tmpCanvas.getContext("2d")!
  ctx.drawImage(image, 0, 0)
  const imageData = ctx.getImageData(0, 0, image.width, image.height)
  const data = imageData.data

  const grid = new Array<number[]>(rows)
  for (let gy = 0; gy < rows; gy++) {
    grid[gy] = new Array<number>(cols)
    for (let gx = 0; gx < cols; gx++) {
      let totalLum = 0
      let count = 0
      const startX = gx * cellSize
      const startY = gy * cellSize
      const endX = Math.min(startX + cellSize, image.width)
      const endY = Math.min(startY + cellSize, image.height)

      for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
          const i = (py * image.width + px) * 4
          const lum =
            (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
          totalLum += lum
          count++
        }
      }
      grid[gy][gx] = count > 0 ? totalLum / count : 0
    }
  }

  return { grid, cols, rows }
}

// ============================================================
// Canvas rendering
// ============================================================

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: string,
  cx: number,
  cy: number,
  cellSize: number,
  sizeFactor: number,
): void {
  const half = (cellSize / 2) * sizeFactor
  if (half < 0.5) return

  switch (shape) {
    case "circle":
      ctx.beginPath()
      ctx.arc(cx, cy, half, 0, Math.PI * 2)
      ctx.fill()
      break
    case "square":
      ctx.fillRect(cx - half, cy - half, half * 2, half * 2)
      break
    case "diamond":
      ctx.beginPath()
      ctx.moveTo(cx, cy - half)
      ctx.lineTo(cx + half, cy)
      ctx.lineTo(cx, cy + half)
      ctx.lineTo(cx - half, cy)
      ctx.closePath()
      ctx.fill()
      break
  }
}

export function renderDither(
  ctx: CanvasRenderingContext2D,
  dithered: DitherCell[][],
  cols: number,
  rows: number,
  settings: {
    cellSize: number
    palette: string[]
    style: string
    shape: string
  },
): void {
  const { cellSize, palette, style, shape } = settings
  const width = cols * cellSize
  const height = rows * cellSize

  ctx.fillStyle = palette[palette.length - 1]
  ctx.fillRect(0, 0, width, height)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = dithered[y][x]
      if (cell.colorIndex === palette.length - 1) continue

      const cx = x * cellSize + cellSize / 2
      const cy = y * cellSize + cellSize / 2

      ctx.fillStyle = palette[cell.colorIndex]

      if (style === "scaled") {
        if (cell.size < 0.01) continue
        drawShape(ctx, shape, cx, cy, cellSize, cell.size)
      } else {
        drawShape(ctx, shape, cx, cy, cellSize, 1.0)
      }
    }
  }
}
