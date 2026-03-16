import type p5 from "p5"
import type { RefObject } from "react"
import type { AsciiSettings } from "./types"

// ============================================
// Character Sets
// ============================================

const CHARACTER_SETS: Record<string, string> = {
  standard: " .:-=+*#%@",
  detailed:
    " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  simple: " .-+*#",
  dots: " ·•●",
  minimal: " ·×",
}

// ============================================
// Main export
// ============================================

export function createAsciiSketch(
  p: p5,
  settingsRef: RefObject<AsciiSettings>,
  imageRef: RefObject<HTMLImageElement | null>,
) {
  // Cache variables
  let cachedPixels: ImageData | null = null
  let cachedVersion = -1

  let brightnessGrid: Float32Array | null = null
  let brightnessGridCols = 0
  let brightnessGridRows = 0

  let spatialNoiseGrid: Float32Array | null = null
  let spatialGridCols = 0
  let spatialGridRows = 0

  let sizeGrid: Float32Array | null = null
  let sizeGridCols = 0
  let sizeGridKey = ""

  let contourColorGrid: Array<{ r: number; g: number; b: number }> | null =
    null
  let contourGridWidth = 0
  let contourGridHeight = 0

  let blocksGridCache: Int32Array | null = null
  let blocksGridW = 0
  let blocksGridH = 0
  let blocksGridLevels = 0

  // ============================================
  // Pixel data cache
  // ============================================

  function ensurePixelData(img: HTMLImageElement, version: number) {
    if (version === cachedVersion && cachedPixels) return
    const off = document.createElement("canvas")
    off.width = img.naturalWidth
    off.height = img.naturalHeight
    const ctx = off.getContext("2d")!
    ctx.drawImage(img, 0, 0)
    cachedPixels = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight)
    cachedVersion = version
    // invalidate downstream caches
    brightnessGrid = null
    brightnessGridCols = 0
    brightnessGridRows = 0
    spatialNoiseGrid = null
    spatialGridCols = 0
    spatialGridRows = 0
    sizeGrid = null
    sizeGridCols = 0
    contourColorGrid = null
    contourGridWidth = 0
    contourGridHeight = 0
    blocksGridCache = null
    blocksGridW = 0
    blocksGridH = 0
    blocksGridLevels = 0
  }

  /** Parse "#rrggbb" to [r,g,b] — cached outside loops */
  function hexToRgb(hex: string): [number, number, number] {
    const v = parseInt(hex.slice(1), 16)
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
  }

  // ============================================
  // Canvas sizing
  // ============================================

  function getCanvasSize() {
    const container = (p as unknown as { canvas: HTMLCanvasElement }).canvas
      ?.parentElement
    if (!container) return { w: 800, h: 600 }
    const cw = container.clientWidth
    const ch = container.clientHeight
    const img = imageRef.current
    if (!img) return { w: Math.min(cw, 800), h: Math.min(ch, 600) }

    const imgAspect = img.naturalWidth / img.naturalHeight
    let w = Math.min(cw, 1024)
    let h = w / imgAspect
    if (h > Math.min(ch, 800)) {
      h = Math.min(ch, 800)
      w = h * imgAspect
    }
    if (w > cw) {
      w = cw
      h = w / imgAspect
    }
    return { w: Math.floor(w), h: Math.floor(h) }
  }

  // ============================================
  // Character mixing
  // ============================================

  function hashPosition(x: number, y: number, seed: number) {
    let h = seed
    h = ((h << 5) - h + x) | 0
    h = ((h << 5) - h + y) | 0
    h = ((h << 5) - h + (x * y)) | 0
    return Math.abs(h)
  }

  function getEnabledSets(s: AsciiSettings) {
    return Object.entries(s.setConfig)
      .filter(([, cfg]) => cfg.enabled)
      .map(([name, cfg]) => ({ name, ...cfg }))
  }

  function getNormalizedWeights(s: AsciiSettings) {
    const enabled = getEnabledSets(s)
    const total = enabled.reduce((sum, e) => sum + e.weight, 0)
    if (total === 0)
      return enabled.map((e) => ({
        ...e,
        normalizedWeight: 1 / enabled.length,
      }))
    return enabled.map((e) => ({ ...e, normalizedWeight: e.weight / total }))
  }

  function selectSetByWeight(normalizedValue: number, s: AsciiSettings) {
    const weighted = getNormalizedWeights(s)
    let cumulative = 0
    for (const w of weighted) {
      cumulative += w.normalizedWeight
      if (normalizedValue <= cumulative) return w.name
    }
    return weighted.length > 0 ? weighted[weighted.length - 1].name : s.charSet
  }

  function selectSetRandom(col: number, row: number, s: AsciiSettings) {
    const hash = hashPosition(col, row, s.mixingSeed)
    const normalized = (hash % 10000) / 10000
    return selectSetByWeight(normalized, s)
  }

  function selectSetByBrightness(brightness: number, s: AsciiSettings) {
    const zone =
      brightness < 0.33 ? "dark" : brightness < 0.66 ? "mid" : "light"
    const assignedSet = s.zoneMapping[zone]
    if (
      s.setConfig[assignedSet as keyof typeof s.setConfig] &&
      s.setConfig[assignedSet as keyof typeof s.setConfig].enabled
    ) {
      return assignedSet
    }
    const enabled = getEnabledSets(s)
    return enabled.length > 0 ? enabled[0].name : s.charSet
  }

  function ensureSpatialNoiseGrid(
    cols: number,
    rows: number,
    s: AsciiSettings,
  ) {
    if (spatialGridCols === cols && spatialGridRows === rows && spatialNoiseGrid)
      return
    spatialNoiseGrid = new Float32Array(cols * rows)
    spatialGridCols = cols
    spatialGridRows = rows
    p.noiseSeed(s.mixingSeed)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        spatialNoiseGrid[r * cols + c] = p.noise(
          c * s.spatialNoiseScale,
          r * s.spatialNoiseScale,
        )
      }
    }
  }

  function selectSetSpatial(
    col: number,
    row: number,
    cols: number,
    rows: number,
    s: AsciiSettings,
  ) {
    ensureSpatialNoiseGrid(cols, rows, s)
    const noiseVal = spatialNoiseGrid![row * cols + col]
    return selectSetByWeight(noiseVal, s)
  }

  function selectSetHybrid(
    brightness: number,
    col: number,
    row: number,
    cols: number,
    rows: number,
    s: AsciiSettings,
  ) {
    const total = s.hybridBlend.random + s.hybridBlend.zone + s.hybridBlend.spatial
    const randomFactor = s.hybridBlend.random / total
    const zoneFactor = s.hybridBlend.zone / total
    const methodHash =
      (hashPosition(col, row, s.mixingSeed + 999) % 1000) / 1000
    if (methodHash < randomFactor) return selectSetRandom(col, row, s)
    if (methodHash < randomFactor + zoneFactor)
      return selectSetByBrightness(brightness, s)
    return selectSetSpatial(col, row, cols, rows, s)
  }

  function getMixedCharacter(
    brightness: number,
    col: number,
    row: number,
    cols: number,
    rows: number,
    s: AsciiSettings,
  ) {
    if (!s.mixingEnabled) {
      const chars = CHARACTER_SETS[s.charSet] || CHARACTER_SETS.standard
      const idx = Math.floor(brightness * (chars.length - 1))
      return chars[Math.min(idx, chars.length - 1)]
    }

    const enabled = getEnabledSets(s)
    if (enabled.length === 0) {
      const chars = CHARACTER_SETS[s.charSet] || CHARACTER_SETS.standard
      const idx = Math.floor(brightness * (chars.length - 1))
      return chars[Math.min(idx, chars.length - 1)]
    }

    if (enabled.length === 1) {
      const chars = CHARACTER_SETS[enabled[0].name]
      const idx = Math.floor(brightness * (chars.length - 1))
      return chars[Math.min(idx, chars.length - 1)]
    }

    let selectedSet: string
    switch (s.mixingMode) {
      case "random":
        selectedSet = selectSetRandom(col, row, s)
        break
      case "brightness":
        selectedSet = selectSetByBrightness(brightness, s)
        break
      case "spatial":
        selectedSet = selectSetSpatial(col, row, cols, rows, s)
        break
      case "hybrid":
        selectedSet = selectSetHybrid(brightness, col, row, cols, rows, s)
        break
      default:
        selectedSet = enabled[0].name
    }

    const chars = CHARACTER_SETS[selectedSet] || CHARACTER_SETS.standard
    const idx = Math.floor(brightness * (chars.length - 1))
    return chars[Math.min(idx, chars.length - 1)]
  }

  // ============================================
  // Size Variation
  // ============================================

  function mapSizeFromScore(score: number, s: AsciiSettings) {
    const { minSize, maxSize, sizeSteps } = s.sizeConfig
    const clamped = Math.max(0, Math.min(1, score))
    const stepIndex = Math.min(Math.floor(clamped * sizeSteps), sizeSteps - 1)
    const sizeRange = maxSize - minSize
    const stepSize = sizeRange / Math.max(1, sizeSteps - 1)
    return minSize + stepIndex * stepSize
  }

  function computeBrightnessDataForSizing(cols: number, rows: number) {
    if (!cachedPixels) return { grid: new Float32Array(0), cols: 0, rows: 0 }
    const grid = new Float32Array(cols * rows)
    const imgW = cachedPixels.width
    const imgH = cachedPixels.height
    const cellW = imgW / cols
    const cellH = imgH / rows

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = Math.min(Math.floor(c * cellW + cellW / 2), imgW - 1)
        const sy = Math.min(Math.floor(r * cellH + cellH / 2), imgH - 1)
        const i = (sy * imgW + sx) * 4
        const rv = cachedPixels.data[i]
        const gv = cachedPixels.data[i + 1]
        const bv = cachedPixels.data[i + 2]
        grid[r * cols + c] = (0.299 * rv + 0.587 * gv + 0.114 * bv) / 255
      }
    }
    return { grid, cols, rows }
  }

  function computeSizeByDetail(
    col: number,
    row: number,
    cols: number,
    rows: number,
    brightnessData: { grid: Float32Array; cols: number; rows: number },
    s: AsciiSettings,
  ) {
    const sx = Math.floor(((col + 0.5) / cols) * brightnessData.cols)
    const sy = Math.floor(((row + 0.5) / rows) * brightnessData.rows)
    const x = Math.max(1, Math.min(brightnessData.cols - 2, sx))
    const y = Math.max(1, Math.min(brightnessData.rows - 2, sy))

    const brightness = brightnessData.grid[y * brightnessData.cols + x]
    const idx = y * brightnessData.cols + x
    const left = brightnessData.grid[idx - 1]
    const right = brightnessData.grid[idx + 1]
    const up = brightnessData.grid[idx - brightnessData.cols]
    const down = brightnessData.grid[idx + brightnessData.cols]
    const gx = right - left
    const gy = down - up
    const edgeStrength = Math.sqrt(gx * gx + gy * gy)

    const biasFactor = s.sizeDetailSettings.brightnessBias / 100
    const brightnessFactor =
      brightness * biasFactor + (1 - brightness) * (1 - biasFactor)
    const edgeWeight = s.sizeDetailSettings.edgeSensitivity / 100
    const detailScore =
      edgeStrength * edgeWeight + brightnessFactor * (1 - edgeWeight)
    const threshold = s.sizeDetailSettings.detailThreshold / 100

    if (detailScore > threshold) return mapSizeFromScore(1 - detailScore, s)
    return mapSizeFromScore(1 - threshold, s)
  }

  function computeSizeByTexture(
    col: number,
    row: number,
    s: AsciiSettings,
  ) {
    const nx = col * s.sizeTextureSettings.noiseScale
    const ny = row * s.sizeTextureSettings.noiseScale

    let noiseValue = 0
    let amplitude = 1
    let frequency = 1
    let maxAmplitude = 0

    p.noiseSeed(s.sizeTextureSettings.seed)
    for (let o = 0; o < s.sizeTextureSettings.noiseOctaves; o++) {
      noiseValue += p.noise(nx * frequency, ny * frequency) * amplitude
      maxAmplitude += amplitude
      amplitude *= 0.5
      frequency *= 2
    }
    return mapSizeFromScore(noiseValue / maxAmplitude, s)
  }

  function computeSizeByFocus(
    col: number,
    row: number,
    cols: number,
    rows: number,
    s: AsciiSettings,
  ) {
    const nx = (col + 0.5) / cols
    const ny = (row + 0.5) / rows
    const dx = nx - s.sizeFocusSettings.focusX
    const dy = ny - s.sizeFocusSettings.focusY
    const distance = Math.sqrt(dx * dx + dy * dy)
    const normalizedDist = Math.min(
      1,
      distance / Math.max(0.01, s.sizeFocusSettings.focusRadius),
    )

    let falloff: number
    switch (s.sizeFocusSettings.falloffCurve) {
      case "ease-in":
        falloff = normalizedDist * normalizedDist
        break
      case "ease-out":
        falloff = 1 - Math.pow(1 - normalizedDist, 2)
        break
      case "gaussian":
        falloff = 1 - Math.exp(-normalizedDist * normalizedDist * 3)
        break
      default:
        falloff = normalizedDist
    }

    if (s.sizeFocusSettings.centerSize === "large") falloff = 1 - falloff
    return mapSizeFromScore(falloff, s)
  }

  function ensureSizeGrid(cols: number, rows: number, s: AsciiSettings) {
    const key = `${cols},${rows},${s.sizeVariationMode},${JSON.stringify(s.sizeConfig)},${JSON.stringify(s.sizeDetailSettings)},${JSON.stringify(s.sizeTextureSettings)},${JSON.stringify(s.sizeFocusSettings)}`
    if (sizeGrid && sizeGridKey === key) return
    sizeGridKey = key
    sizeGrid = new Float32Array(cols * rows)
    sizeGridCols = cols

    let brightnessData: { grid: Float32Array; cols: number; rows: number } | null = null
    if (s.sizeVariationMode === "detail") {
      const detailCols = Math.max(cols, 64)
      const detailRows = Math.max(rows, 64)
      brightnessData = computeBrightnessDataForSizing(detailCols, detailRows)
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let size: number
        switch (s.sizeVariationMode) {
          case "detail":
            size = computeSizeByDetail(col, row, cols, rows, brightnessData!, s)
            break
          case "texture":
            size = computeSizeByTexture(col, row, s)
            break
          case "focus":
            size = computeSizeByFocus(col, row, cols, rows, s)
            break
          default:
            size = s.fontSize
        }
        sizeGrid[row * cols + col] = size
      }
    }
  }

  // ============================================
  // ASCII Art Rendering
  // ============================================

  function drawAsciiArt(s: AsciiSettings) {
    if (!cachedPixels) return
    const imgW = cachedPixels.width
    const imgH = cachedPixels.height

    if (s.sizeVariationEnabled) {
      drawAsciiArtWithSizeVariation(s, imgW, imgH)
      return
    }

    const charAspect = 0.6 + s.letterSpacing * 0.05
    const actualFontSize = s.fontSize
    const charHeight = actualFontSize * s.lineHeight
    const charWidth = actualFontSize * charAspect

    const cols = Math.max(1, Math.floor(p.width / charWidth))
    const rows = Math.max(1, Math.floor(p.height / charHeight))

    const totalWidth = cols * charWidth
    const totalHeight = rows * charHeight
    const offsetX = (p.width - totalWidth) / 2
    const offsetY = (p.height - totalHeight) / 2

    const cellW = imgW / cols
    const cellH = imgH / rows

    // Use canvas 2D API directly for ~10x speedup over p5.text()/p5.fill()
    const ctx = p.drawingContext as CanvasRenderingContext2D
    ctx.save()
    ctx.font = `${actualFontSize}px monospace`
    ctx.textAlign = "left"
    ctx.textBaseline = "top"

    const alphaFrac = s.asciiOpacity / 100
    const contrastFactor = s.contrast / 100
    const sat = s.colorSaturation / 100
    const data = cachedPixels.data
    // Pre-compute mono fillStyle once
    const monoStyle = !s.useColors
      ? (() => { const [r, g, b] = hexToRgb(s.textColor); return `rgba(${r},${g},${b},${alphaFrac})` })()
      : ""
    if (monoStyle) ctx.fillStyle = monoStyle

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = Math.min(Math.floor(col * cellW + cellW / 2), imgW - 1)
        const sy = Math.min(Math.floor(row * cellH + cellH / 2), imgH - 1)
        const i = (sy * imgW + sx) * 4
        if (data[i + 3] < 128) continue

        let r = Math.max(0, Math.min(255, ((data[i] / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
        let g = Math.max(0, Math.min(255, ((data[i + 1] / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
        let b = Math.max(0, Math.min(255, ((data[i + 2] / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))

        let bright = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        if (s.invert) bright = 1 - bright

        const char = getMixedCharacter(bright, col, row, cols, rows, s)

        if (s.useColors) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b
          r = gray + (r - gray) * sat
          g = gray + (g - gray) * sat
          b = gray + (b - gray) * sat
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alphaFrac})`
        }

        ctx.fillText(char, offsetX + col * charWidth, offsetY + row * charHeight)
      }
    }
    ctx.restore()
  }

  function drawAsciiArtWithSizeVariation(
    s: AsciiSettings,
    imgW: number,
    imgH: number,
  ) {
    const charAspect = 0.6 + s.letterSpacing * 0.05
    const baseFontSize = s.fontSize
    const baseCharHeight = baseFontSize * s.lineHeight
    const baseCharWidth = baseFontSize * charAspect

    const cols = Math.max(1, Math.floor(p.width / baseCharWidth))
    const rows = Math.max(1, Math.floor(p.height / baseCharHeight))

    ensureSizeGrid(cols, rows, s)

    const totalWidth = cols * baseCharWidth
    const totalHeight = rows * baseCharHeight
    const offsetX = (p.width - totalWidth) / 2
    const offsetY = (p.height - totalHeight) / 2

    const cellW = imgW / cols
    const cellH = imgH / rows

    // Use canvas 2D API directly
    const ctx = p.drawingContext as CanvasRenderingContext2D
    ctx.save()
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    const alphaFrac = s.asciiOpacity / 100
    const contrastFactor = s.contrast / 100
    const sat = s.colorSaturation / 100
    const data = cachedPixels!.data
    let lastFontSize = -1
    // Pre-compute mono fillStyle once
    const monoStyle = !s.useColors
      ? (() => { const [r, g, b] = hexToRgb(s.textColor); return `rgba(${r},${g},${b},${alphaFrac})` })()
      : ""
    if (monoStyle) ctx.fillStyle = monoStyle

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = Math.min(Math.floor(col * cellW + cellW / 2), imgW - 1)
        const sy = Math.min(Math.floor(row * cellH + cellH / 2), imgH - 1)
        const i = (sy * imgW + sx) * 4
        if (data[i + 3] < 128) continue

        let r = Math.max(0, Math.min(255, ((data[i] / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
        let g = Math.max(0, Math.min(255, ((data[i + 1] / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
        let b = Math.max(0, Math.min(255, ((data[i + 2] / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))

        let bright = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        if (s.invert) bright = 1 - bright

        const charFontSize = sizeGrid
          ? sizeGrid[row * sizeGridCols + col]
          : s.fontSize
        const char = getMixedCharacter(bright, col, row, cols, rows, s)

        if (s.useColors) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b
          r = gray + (r - gray) * sat
          g = gray + (g - gray) * sat
          b = gray + (b - gray) * sat
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alphaFrac})`
        }

        // Only set font when size changes (ctx.font is expensive)
        const fs = charFontSize | 0
        if (fs !== lastFontSize) {
          ctx.font = `${fs}px monospace`
          lastFontSize = fs
        }

        ctx.fillText(
          char,
          offsetX + col * baseCharWidth + baseCharWidth / 2,
          offsetY + row * baseCharHeight + baseCharHeight / 2,
        )
      }
    }
    ctx.restore()
  }

  // ============================================
  // Texture Effects
  // ============================================

  function applyGrain(s: AsciiSettings) {
    if (s.grainAmount <= 0) return
    const ctx = p.drawingContext as CanvasRenderingContext2D
    const d = p.pixelDensity()
    const w = p.width * d
    const h = p.height * d
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const intensity = s.grainAmount / 100

    for (let i = 0; i < data.length; i += 4) {
      const grainValue = (Math.random() - 0.5) * intensity * 100
      data[i] = Math.max(0, Math.min(255, data[i] + grainValue))
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grainValue))
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grainValue))
    }
    ctx.putImageData(imageData, 0, 0)
  }

  function applyTexture(s: AsciiSettings) {
    if (s.textureAmount <= 0) return
    const ctx = p.drawingContext as CanvasRenderingContext2D
    const d = p.pixelDensity()
    const w = p.width * d
    const h = p.height * d
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const intensity = s.textureAmount / 100

    // Compute noise at 1/4 resolution then bilinear-interpolate — ~16x fewer noise calls
    const step = 4
    const nw = Math.ceil(w / step) + 1
    const nh = Math.ceil(h / step) + 1
    const noiseMap = new Float32Array(nw * nh)
    for (let ny = 0; ny < nh; ny++) {
      for (let nx = 0; nx < nw; nx++) {
        const px = nx * step
        const py = ny * step
        const fine = p.noise(px * 0.5, py * 0.5) - 0.5
        const med = p.noise(px * 0.08, py * 0.08) - 0.5
        const coarse = p.noise(px * 0.02, py * 0.02) - 0.5
        noiseMap[ny * nw + nx] = (fine * 0.4 + med * 0.35 + coarse * 0.25) * intensity * 80
      }
    }

    for (let y = 0; y < h; y++) {
      const gy = y / step
      const iy = Math.min(gy | 0, nh - 2)
      const fy = gy - iy
      for (let x = 0; x < w; x++) {
        const gx = x / step
        const ix = Math.min(gx | 0, nw - 2)
        const fx = gx - ix
        // Bilinear interpolation
        const idx00 = iy * nw + ix
        const v = noiseMap[idx00] * (1 - fx) * (1 - fy) +
          noiseMap[idx00 + 1] * fx * (1 - fy) +
          noiseMap[idx00 + nw] * (1 - fx) * fy +
          noiseMap[idx00 + nw + 1] * fx * fy

        const i = (y * w + x) * 4
        data[i] = Math.max(0, Math.min(255, data[i] + v))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + v))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + v))
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }

  // ============================================
  // Sketch Elements
  // ============================================

  function wobblePoint(x: number, y: number, amount: number, seed: number) {
    const noiseX = p.noise(x * 0.05, y * 0.05, seed) - 0.5
    const noiseY = p.noise(x * 0.05 + 100, y * 0.05, seed) - 0.5
    return { x: x + noiseX * amount * 2, y: y + noiseY * amount * 2 }
  }

  function wobblyLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    wobbleAmount: number,
    segments = 8,
  ) {
    p.beginShape()
    p.noFill()
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const x = p.lerp(x1, x2, t)
      const y = p.lerp(y1, y2, t)
      const w = wobblePoint(x, y, wobbleAmount, 0)
      p.vertex(w.x, w.y)
    }
    p.endShape()
  }

  function ensureBrightnessGrid(cols: number, rows: number) {
    if (
      brightnessGrid &&
      brightnessGridCols === cols &&
      brightnessGridRows === rows
    )
      return brightnessGrid
    if (!cachedPixels) return null

    brightnessGrid = new Float32Array(cols * rows)
    brightnessGridCols = cols
    brightnessGridRows = rows

    const imgW = cachedPixels.width
    const imgH = cachedPixels.height
    const cellW = imgW / cols
    const cellH = imgH / rows

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = Math.min(
          Math.floor(col * cellW + cellW / 2),
          imgW - 1,
        )
        const sy = Math.min(
          Math.floor(row * cellH + cellH / 2),
          imgH - 1,
        )
        const i = (sy * imgW + sx) * 4
        const r = cachedPixels.data[i]
        const g = cachedPixels.data[i + 1]
        const b = cachedPixels.data[i + 2]
        brightnessGrid[row * cols + col] =
          (0.299 * r + 0.587 * g + 0.114 * b) / 255
      }
    }
    return brightnessGrid
  }

  function detectEdge(
    col: number,
    row: number,
    cols: number,
    rows: number,
    grid: Float32Array,
  ) {
    if (col === 0 || col >= cols - 1 || row === 0 || row >= rows - 1) return 0
    const idx = row * cols + col
    const gx = grid[idx + 1] - grid[idx - 1]
    const gy = grid[idx + cols] - grid[idx - cols]
    return Math.sqrt(gx * gx + gy * gy)
  }

  function shouldDrawSketch(
    brightness: number,
    col: number,
    row: number,
    cols: number,
    rows: number,
    grid: Float32Array,
    s: AsciiSettings,
  ) {
    const minThresh = s.sketchMinThreshold / 100
    const maxThresh = s.sketchMaxThreshold / 100
    let shouldDraw = false

    switch (s.sketchReactTo) {
      case "darks":
        shouldDraw = brightness >= minThresh && brightness <= maxThresh
        break
      case "lights":
        shouldDraw =
          brightness >= 1 - maxThresh && brightness <= 1 - minThresh
        break
      case "midtones":
        shouldDraw = brightness >= 0.33 && brightness <= 0.66
        break
      case "edges": {
        const edgeStrength = detectEdge(col, row, cols, rows, grid)
        shouldDraw =
          edgeStrength > (1 - s.contourEdgeSensitivity / 100) * 0.3
        break
      }
      case "all":
        shouldDraw = true
        break
    }

    if (s.sketchInvert) shouldDraw = !shouldDraw
    return shouldDraw
  }

  function getSketchColor(
    r: number,
    g: number,
    b: number,
    s: AsciiSettings,
  ) {
    let fr: number, fg: number, fb: number

    if (s.sketchColorMatch) {
      fr = r
      fg = g
      fb = b
    } else {
      const c = p.color(s.sketchColor)
      fr = p.red(c)
      fg = p.green(c)
      fb = p.blue(c)
    }

    if (s.sketchColorVariation > 0) {
      const v = s.sketchColorVariation / 100
      fr += (p.noise(r * 0.1, 0) - 0.5) * v * 100
      fg += (p.noise(g * 0.1, 50) - 0.5) * v * 100
      fb += (p.noise(b * 0.1, 100) - 0.5) * v * 100
    }

    if (s.sketchSaturationBoost > 0) {
      const boost = 1 + s.sketchSaturationBoost / 100
      const gray = 0.299 * fr + 0.587 * fg + 0.114 * fb
      fr = gray + (fr - gray) * boost
      fg = gray + (fg - gray) * boost
      fb = gray + (fb - gray) * boost
    }

    return {
      r: Math.max(0, Math.min(255, fr)),
      g: Math.max(0, Math.min(255, fg)),
      b: Math.max(0, Math.min(255, fb)),
    }
  }

  // ---- Hatching ----

  function drawHatchingCell(
    cx: number,
    cy: number,
    brightness: number,
    r: number,
    g: number,
    b: number,
    cellWidth: number,
    cellHeight: number,
    s: AsciiSettings,
  ) {
    const darkness = 1 - brightness
    const density = s.sketchDensity / 100
    const numLines = Math.floor(darkness * density * 5)
    if (numLines === 0) return

    const sketchCol = getSketchColor(r, g, b, s)
    const alpha = p.map(s.sketchOpacity, 0, 100, 0, 255)
    p.stroke(sketchCol.r, sketchCol.g, sketchCol.b, alpha)
    p.strokeWeight(s.sketchStrokeWeight)

    for (let i = 0; i < numLines; i++) {
      const hash = hashPosition(
        Math.floor(cx) * 100 + i,
        Math.floor(cy),
        s.mixingSeed,
      )
      const ox = ((hash % 100) / 100 - 0.5) * cellWidth * 0.9
      const oy = (((hash >> 8) % 100) / 100 - 0.5) * cellHeight * 0.9

      const baseAngle = (s.hatchAngle * Math.PI) / 180
      const variation = ((hash >> 16) % 100) / 100 - 0.5
      const angle =
        baseAngle + variation * ((s.hatchAngleVariation * Math.PI) / 180)
      const length = s.hatchLineLength * (0.5 + darkness * 0.5)

      const x1 = cx + ox - (Math.cos(angle) * length) / 2
      const y1 = cy + oy - (Math.sin(angle) * length) / 2
      const x2 = cx + ox + (Math.cos(angle) * length) / 2
      const y2 = cy + oy + (Math.sin(angle) * length) / 2

      wobblyLine(x1, y1, x2, y2, s.sketchWobble)

      if (s.hatchCrossHatch && i % 2 === 0) {
        const crossAlpha = alpha * (s.hatchCrossOpacity / 100)
        p.stroke(sketchCol.r, sketchCol.g, sketchCol.b, crossAlpha)
        const crossAngle = angle + Math.PI / 2
        const cx1 = cx + ox - (Math.cos(crossAngle) * length) / 2
        const cy1 = cy + oy - (Math.sin(crossAngle) * length) / 2
        const cx2 = cx + ox + (Math.cos(crossAngle) * length) / 2
        const cy2 = cy + oy + (Math.sin(crossAngle) * length) / 2
        wobblyLine(cx1, cy1, cx2, cy2, s.sketchWobble)
        p.stroke(sketchCol.r, sketchCol.g, sketchCol.b, alpha)
      }
    }
  }

  // ---- Stipple ----

  function drawStippleCell(
    cx: number,
    cy: number,
    brightness: number,
    r: number,
    g: number,
    b: number,
    cellWidth: number,
    cellHeight: number,
    s: AsciiSettings,
  ) {
    const darkness = 1 - brightness
    const density = s.sketchDensity / 100
    const numDots = Math.floor(darkness * density * 8)
    if (numDots === 0) return

    const sketchCol = getSketchColor(r, g, b, s)
    const alpha = p.map(s.sketchOpacity, 0, 100, 0, 255)
    p.noStroke()
    const clustering = s.stippleClustering / 100

    for (let i = 0; i < numDots; i++) {
      const hash = hashPosition(
        Math.floor(cx) * 50 + i,
        Math.floor(cy) * 50,
        s.mixingSeed + 7777,
      )

      let dx: number, dy: number
      if (clustering > 0.5) {
        const clusterStrength = (clustering - 0.5) * 2
        dx =
          ((hash % 100) / 100 - 0.5) * cellWidth * (1 - clusterStrength * 0.7)
        dy =
          (((hash >> 8) % 100) / 100 - 0.5) *
          cellHeight *
          (1 - clusterStrength * 0.7)
      } else {
        dx = ((hash % 100) / 100 - 0.5) * cellWidth
        dy = (((hash >> 8) % 100) / 100 - 0.5) * cellHeight
      }

      const sizeVar = s.stippleSizeVariation / 100
      const baseSize = s.stippleDotSize
      const dotSize =
        baseSize * (1 - sizeVar / 2 + (((hash >> 16) % 100) / 100) * sizeVar)

      const wobX = (p.noise(cx + i * 0.1, cy, 0) - 0.5) * s.sketchWobble
      const wobY = (p.noise(cx + i * 0.1 + 50, cy, 0) - 0.5) * s.sketchWobble

      p.fill(sketchCol.r, sketchCol.g, sketchCol.b, alpha)
      p.ellipse(cx + dx + wobX, cy + dy + wobY, dotSize, dotSize)
    }
  }

  // ---- Contour Lines ----

  function computeContourGrid() {
    if (!cachedPixels) return null
    const resolution = Math.max(
      2,
      Math.floor(6 - (settingsRef.current?.contourSmoothness ?? 5) / 3),
    )
    const gridW = Math.floor(p.width / resolution)
    const gridH = Math.floor(p.height / resolution)

    if (contourColorGrid && contourGridWidth === gridW && contourGridHeight === gridH) {
      return { grid: contourColorGrid, w: gridW, h: gridH, res: resolution }
    }

    contourColorGrid = new Array(gridW * gridH)
    contourGridWidth = gridW
    contourGridHeight = gridH

    const imgW = cachedPixels.width
    const imgH = cachedPixels.height

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const ix = Math.min(Math.floor((x / gridW) * imgW), imgW - 1)
        const iy = Math.min(Math.floor((y / gridH) * imgH), imgH - 1)
        const idx = (iy * imgW + ix) * 4
        contourColorGrid[y * gridW + x] = {
          r: cachedPixels.data[idx],
          g: cachedPixels.data[idx + 1],
          b: cachedPixels.data[idx + 2],
        }
      }
    }
    return { grid: contourColorGrid, w: gridW, h: gridH, res: resolution }
  }

  function getContourEdgeStrength(
    x: number,
    y: number,
    w: number,
    h: number,
    grid: Array<{ r: number; g: number; b: number }>,
  ) {
    if (x <= 1 || x >= w - 2 || y <= 1 || y >= h - 2) return 0
    const idx = y * w + x
    const left = grid[idx - 1]
    const right = grid[idx + 1]
    const top = grid[idx - w]
    const bottom = grid[idx + w]
    const topLeft = grid[idx - w - 1]
    const topRight = grid[idx - w + 1]
    const bottomLeft = grid[idx + w - 1]
    const bottomRight = grid[idx + w + 1]

    const gxR =
      topRight.r + 2 * right.r + bottomRight.r - (topLeft.r + 2 * left.r + bottomLeft.r)
    const gxG =
      topRight.g + 2 * right.g + bottomRight.g - (topLeft.g + 2 * left.g + bottomLeft.g)
    const gxB =
      topRight.b + 2 * right.b + bottomRight.b - (topLeft.b + 2 * left.b + bottomLeft.b)
    const gyR =
      bottomLeft.r + 2 * bottom.r + bottomRight.r - (topLeft.r + 2 * top.r + topRight.r)
    const gyG =
      bottomLeft.g + 2 * bottom.g + bottomRight.g - (topLeft.g + 2 * top.g + topRight.g)
    const gyB =
      bottomLeft.b + 2 * bottom.b + bottomRight.b - (topLeft.b + 2 * top.b + topRight.b)

    const magR = Math.sqrt(gxR * gxR + gyR * gyR)
    const magG = Math.sqrt(gxG * gxG + gyG * gyG)
    const magB = Math.sqrt(gxB * gxB + gyB * gyB)
    return Math.max(magR, magG, magB) / 1020
  }

  function getContourGradientAngle(
    x: number,
    y: number,
    w: number,
    h: number,
    grid: Array<{ r: number; g: number; b: number }>,
  ) {
    if (x <= 1 || x >= w - 2 || y <= 1 || y >= h - 2) return 0
    const idx = y * w + x
    const left = grid[idx - 1]
    const right = grid[idx + 1]
    const top = grid[idx - w]
    const bottom = grid[idx + w]

    const leftB = 0.299 * left.r + 0.587 * left.g + 0.114 * left.b
    const rightB = 0.299 * right.r + 0.587 * right.g + 0.114 * right.b
    const topB = 0.299 * top.r + 0.587 * top.g + 0.114 * top.b
    const bottomB = 0.299 * bottom.r + 0.587 * bottom.g + 0.114 * bottom.b

    return Math.atan2(bottomB - topB, rightB - leftB)
  }

  function traceContourLine(
    startX: number,
    startY: number,
    w: number,
    h: number,
    grid: Array<{ r: number; g: number; b: number }>,
    resolution: number,
    s: AsciiSettings,
  ) {
    const points: Array<{ x: number; y: number; strength: number }> = []
    const minStrength = s.contourMinStrength / 100
    const threshold = 0.01 + minStrength * 0.4
    const maxSteps = 1000
    const stepSize = resolution * 2.0

    for (let dir = -1; dir <= 1; dir += 2) {
      let x = startX
      let y = startY
      let lastAngle: number | null = null
      let lowStrengthCount = 0
      let lastGridKey = -1
      let stuckCount = 0

      for (let step = 0; step < maxSteps; step++) {
        const gridX = Math.floor(x / resolution)
        const gridY = Math.floor(y / resolution)
        if (gridX <= 2 || gridX >= w - 3 || gridY <= 2 || gridY >= h - 3) break

        const edgeStrength = getContourEdgeStrength(gridX, gridY, w, h, grid)
        const gridKey = gridY * w + gridX
        if (gridKey === lastGridKey) {
          stuckCount++
          if (stuckCount > 3) break
        } else {
          stuckCount = 0
          lastGridKey = gridKey
        }

        if (edgeStrength < threshold) {
          lowStrengthCount++
          if (lowStrengthCount > 8) break
        } else {
          lowStrengthCount = 0
        }

        let angle: number
        switch (s.contourFlowDirection) {
          case "horizontal":
            angle = 0
            break
          case "vertical":
            angle = Math.PI / 2
            break
          case "angled-right":
            angle = Math.PI / 4
            break
          case "angled-left":
            angle = -Math.PI / 4
            break
          case "radial":
            angle =
              Math.atan2(y - p.height / 2, x - p.width / 2) + Math.PI / 2
            break
          default:
            angle =
              getContourGradientAngle(gridX, gridY, w, h, grid) + Math.PI / 2
            break
        }

        if (lastAngle !== null) {
          let angleDiff = angle - lastAngle
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
          if (Math.abs(angleDiff) > Math.PI / 2.5) {
            angle = lastAngle + Math.sign(angleDiff) * (Math.PI / 2.5)
          }
        }
        lastAngle = angle

        if (dir === -1) {
          points.unshift({ x, y, strength: edgeStrength })
        } else {
          points.push({ x, y, strength: edgeStrength })
        }

        x += Math.cos(angle) * stepSize * dir
        y += Math.sin(angle) * stepSize * dir
      }
    }
    return points
  }

  function drawContourLines(s: AsciiSettings) {
    const result = computeContourGrid()
    if (!result) return
    const { grid, w, h, res } = result

    const minStrength = s.contourMinStrength / 100
    const seedThreshold = 0.02 + minStrength * 0.5
    const density = s.sketchDensity / 100
    const spacing = Math.max(1, Math.floor(8 - density * 6))
    const visited = new Set<string>()
    const lines: Array<Array<{ x: number; y: number; strength: number }>> = []

    const edgePoints: Array<{
      gx: number
      gy: number
      strength: number
    }> = []
    for (let gy = 3; gy < h - 3; gy += spacing) {
      for (let gx = 3; gx < w - 3; gx += spacing) {
        const edgeStrength = getContourEdgeStrength(gx, gy, w, h, grid)
        if (edgeStrength > seedThreshold) {
          edgePoints.push({ gx, gy, strength: edgeStrength })
        }
      }
    }
    edgePoints.sort((a, b) => b.strength - a.strength)

    const maxLines = Math.floor(50 + density * 200)
    let linesTraced = 0

    for (const pt of edgePoints) {
      if (linesTraced >= maxLines) break
      const visitKey = `${Math.floor(pt.gy / 3)},${Math.floor(pt.gx / 3)}`
      if (visited.has(visitKey)) continue
      visited.add(visitKey)

      const points = traceContourLine(
        pt.gx * res,
        pt.gy * res,
        w,
        h,
        grid,
        res,
        s,
      )
      if (points.length >= 8) {
        lines.push(points)
        linesTraced++
      }
    }

    if (!cachedPixels) return
    const imgW = cachedPixels.width
    const imgH = cachedPixels.height
    const alpha = p.map(s.sketchOpacity, 0, 100, 0, 255)
    p.strokeWeight(s.sketchStrokeWeight)
    p.noFill()

    for (const line of lines) {
      if (line.length < 4) continue
      const midPoint = line[Math.floor(line.length / 2)]
      const ix = Math.min(
        Math.floor((midPoint.x / p.width) * imgW),
        imgW - 1,
      )
      const iy = Math.min(
        Math.floor((midPoint.y / p.height) * imgH),
        imgH - 1,
      )
      const idx = (iy * imgW + ix) * 4

      let r = cachedPixels.data[idx]
      let g = cachedPixels.data[idx + 1]
      let b = cachedPixels.data[idx + 2]

      const contrastFactor = s.contrast / 100
      r = Math.max(0, Math.min(255, ((r / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
      g = Math.max(0, Math.min(255, ((g / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
      b = Math.max(0, Math.min(255, ((b / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))

      const sketchCol = getSketchColor(r, g, b, s)
      const avgStrength =
        line.reduce((sum, pt) => sum + pt.strength, 0) / line.length
      const lineAlpha = alpha * Math.min(1, avgStrength * 4)

      p.stroke(sketchCol.r, sketchCol.g, sketchCol.b, lineAlpha)
      p.beginShape()
      for (let i = 0; i < line.length; i++) {
        const pt = line[i]
        const wobbleAmt = s.sketchWobble * (0.5 + (p.noise(i * 0.1, 0) - 0.5))
        const wobbled = wobblePoint(pt.x, pt.y, wobbleAmt, i * 0.01)
        p.splineVertex(wobbled.x, wobbled.y)
      }
      p.endShape()
    }
  }

  // ---- Blocks (flood-fill approach) ----

  function getPixelLevel(r: number, g: number, b: number, levels: number) {
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    return Math.min(Math.floor(brightness * levels), levels - 1)
  }

  function computeBlocksGrid(s: AsciiSettings) {
    if (!cachedPixels) return null
    const imgW = cachedPixels.width
    const imgH = cachedPixels.height
    const baseRes = Math.max(
      2,
      Math.floor(Math.min(imgW, imgH) / 150),
    )
    const w = Math.ceil(imgW / baseRes)
    const h = Math.ceil(imgH / baseRes)

    if (
      blocksGridCache &&
      blocksGridW === w &&
      blocksGridH === h &&
      blocksGridLevels === s.blocksLevels
    ) {
      return { grid: blocksGridCache, w, h, res: baseRes, imgW, imgH }
    }

    blocksGridCache = new Int32Array(w * h)
    blocksGridW = w
    blocksGridH = h
    blocksGridLevels = s.blocksLevels

    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const px = Math.min(gx * baseRes, imgW - 1)
        const py = Math.min(gy * baseRes, imgH - 1)
        const idx = (py * imgW + px) * 4
        blocksGridCache[gy * w + gx] = getPixelLevel(
          cachedPixels.data[idx],
          cachedPixels.data[idx + 1],
          cachedPixels.data[idx + 2],
          s.blocksLevels,
        )
      }
    }
    return { grid: blocksGridCache, w, h, res: baseRes, imgW, imgH }
  }

  function findBlockRegions(grid: Int32Array, w: number, h: number) {
    const visited = new Uint8Array(w * h)
    const regions: Array<{
      level: number
      cells: Array<{ x: number; y: number }>
    }> = []

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (visited[idx]) continue
        const level = grid[idx]
        const region: { level: number; cells: Array<{ x: number; y: number }> } = { level, cells: [] }
        const stack = [{ x, y }]
        while (stack.length > 0) {
          const { x: cx, y: cy } = stack.pop()!
          const cIdx = cy * w + cx
          if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue
          if (visited[cIdx] || grid[cIdx] !== level) continue
          visited[cIdx] = 1
          region.cells.push({ x: cx, y: cy })
          stack.push({ x: cx + 1, y: cy })
          stack.push({ x: cx - 1, y: cy })
          stack.push({ x: cx, y: cy + 1 })
          stack.push({ x: cx, y: cy - 1 })
        }
        regions.push(region)
      }
    }
    return regions
  }

  function traceRegionBoundary(
    region: { cells: Array<{ x: number; y: number }> },
    res: number,
  ) {
    if (region.cells.length === 0) return []
    const cellSet = new Set(region.cells.map((c) => `${c.x},${c.y}`))
    const isInRegion = (x: number, y: number) => cellSet.has(`${x},${y}`)
    const edges = new Map<string, { x: number; y: number }>()

    for (const cell of region.cells) {
      const cx = cell.x
      const cy = cell.y
      if (!isInRegion(cx, cy - 1))
        edges.set(`${cx},${cy}`, { x: cx + 1, y: cy })
      if (!isInRegion(cx + 1, cy))
        edges.set(`${cx + 1},${cy}`, { x: cx + 1, y: cy + 1 })
      if (!isInRegion(cx, cy + 1))
        edges.set(`${cx + 1},${cy + 1}`, { x: cx, y: cy + 1 })
      if (!isInRegion(cx - 1, cy))
        edges.set(`${cx},${cy + 1}`, { x: cx, y: cy })
    }

    if (edges.size === 0) return []

    const points: Array<{ x: number; y: number }> = []
    const usedEdges = new Set<string>()
    const [startKey] = edges.keys()
    let currentKey = startKey
    const maxIter = edges.size + 10
    let iter = 0

    while (iter < maxIter) {
      if (usedEdges.has(currentKey)) break
      usedEdges.add(currentKey)
      const [sx, sy] = currentKey.split(",").map(Number)
      points.push({ x: sx * res, y: sy * res })
      const next = edges.get(currentKey)
      if (!next) break
      currentKey = `${next.x},${next.y}`
      iter++
    }
    return points
  }

  function perpendicularDistance(
    point: { x: number; y: number },
    lineStart: { x: number; y: number },
    lineEnd: { x: number; y: number },
  ) {
    const dx = lineEnd.x - lineStart.x
    const dy = lineEnd.y - lineStart.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) {
      return Math.sqrt(
        (point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2,
      )
    }
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq,
      ),
    )
    const projX = lineStart.x + t * dx
    const projY = lineStart.y + t * dy
    return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2)
  }

  function douglasPeucker(
    points: Array<{ x: number; y: number }>,
    tolerance: number,
  ): Array<{ x: number; y: number }> {
    if (points.length <= 2) return points
    let maxDist = 0
    let maxIndex = 0
    const first = points[0]
    const last = points[points.length - 1]

    for (let i = 1; i < points.length - 1; i++) {
      const dist = perpendicularDistance(points[i], first, last)
      if (dist > maxDist) {
        maxDist = dist
        maxIndex = i
      }
    }
    if (maxDist > tolerance) {
      const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance)
      const right = douglasPeucker(points.slice(maxIndex), tolerance)
      return left.slice(0, -1).concat(right)
    }
    return [first, last]
  }

  function drawBlocks(s: AsciiSettings) {
    const result = computeBlocksGrid(s)
    if (!result || !cachedPixels) return
    const { grid, w, h, res, imgW, imgH } = result

    const regions = findBlockRegions(grid, w, h)
    const scaleX = p.width / imgW
    const scaleY = p.height / imgH
    const smoothingNorm = s.blocksSmoothing / 100
    const alpha = p.map(s.sketchOpacity, 0, 100, 0, 255)
    const fillAlpha = p.map(s.blocksFillOpacity, 0, 100, 0, 255)
    const minArea = s.blocksMinSize

    for (const region of regions) {
      if (region.cells.length < minArea) continue
      const boundary = traceRegionBoundary(region, res)
      if (boundary.length < 3) continue

      // Scale to canvas coords
      const scaled = boundary.map((pt) => ({
        x: pt.x * scaleX,
        y: pt.y * scaleY,
      }))

      const tolerance = 2 + smoothingNorm * 50
      const simplified = douglasPeucker(scaled, tolerance)
      if (simplified.length < 3) continue

      // Apply wobble
      const wobAmt = s.sketchWobble * 0.5
      const finalPoints = simplified.map((pt, i) => {
        if (wobAmt < 0.1) return pt
        const w = wobblePoint(pt.x, pt.y, wobAmt, i * 0.2)
        return { x: w.x, y: w.y }
      })

      // Get color from region center
      const midCell = region.cells[Math.floor(region.cells.length / 2)]
      const px = Math.min(midCell.x * res, imgW - 1)
      const py = Math.min(midCell.y * res, imgH - 1)
      const idx = (py * imgW + px) * 4

      let r = cachedPixels.data[idx]
      let g = cachedPixels.data[idx + 1]
      let b = cachedPixels.data[idx + 2]

      const contrastFactor = s.contrast / 100
      r = Math.max(0, Math.min(255, ((r / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
      g = Math.max(0, Math.min(255, ((g / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
      b = Math.max(0, Math.min(255, ((b / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))

      if (s.sketchColorMatch) {
        p.stroke(r, g, b, alpha)
        if (s.blocksFill) p.fill(r, g, b, fillAlpha)
        else p.noFill()
      } else {
        const c = p.color(s.sketchColor)
        p.stroke(p.red(c), p.green(c), p.blue(c), alpha)
        if (s.blocksFill) p.fill(p.red(c), p.green(c), p.blue(c), fillAlpha)
        else p.noFill()
      }

      p.strokeWeight(s.sketchStrokeWeight)

      p.beginShape()
      const n = finalPoints.length
      for (let i = -2; i < n + 2; i++) {
        const pt = finalPoints[(i + n) % n]
        p.splineVertex(pt.x, pt.y)
      }
      p.endShape(p.CLOSE)
    }
  }

  // ---- Main sketch elements dispatcher ----

  function drawSketchElements(s: AsciiSettings) {
    if (!s.sketchEnabled || !cachedPixels) return

    switch (s.sketchBlendMode) {
      case "multiply":
        p.blendMode(p.MULTIPLY)
        break
      case "screen":
        p.blendMode(p.SCREEN)
        break
      case "overlay":
        p.blendMode(p.OVERLAY)
        break
      default:
        p.blendMode(p.BLEND)
    }

    p.push()

    if (s.sketchStyle === "contour") {
      drawContourLines(s)
      p.pop()
      p.blendMode(p.BLEND)
      return
    }

    if (s.sketchStyle === "blocks") {
      drawBlocks(s)
      p.pop()
      p.blendMode(p.BLEND)
      return
    }

    // Cell-based styles
    const charAspect = 0.6 + s.letterSpacing * 0.05
    const charHeight = s.fontSize * s.lineHeight
    const charWidth = s.fontSize * charAspect

    const cols = Math.max(1, Math.floor(p.width / charWidth))
    const rows = Math.max(1, Math.floor(p.height / charHeight))

    const totalWidth = cols * charWidth
    const totalHeight = rows * charHeight
    const offsetX = (p.width - totalWidth) / 2
    const offsetY = (p.height - totalHeight) / 2

    const imgW = cachedPixels.width
    const imgH = cachedPixels.height
    const cellW = imgW / cols
    const cellH = imgH / rows

    const grid = ensureBrightnessGrid(cols, rows)
    if (!grid) {
      p.pop()
      p.blendMode(p.BLEND)
      return
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = Math.min(Math.floor(col * cellW + cellW / 2), imgW - 1)
        const sy = Math.min(Math.floor(row * cellH + cellH / 2), imgH - 1)
        const idx = (sy * imgW + sx) * 4

        let r = cachedPixels.data[idx]
        let g = cachedPixels.data[idx + 1]
        let b = cachedPixels.data[idx + 2]
        const a = cachedPixels.data[idx + 3]
        if (a < 128) continue

        const contrastFactor = s.contrast / 100
        r = Math.max(0, Math.min(255, ((r / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
        g = Math.max(0, Math.min(255, ((g / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))
        b = Math.max(0, Math.min(255, ((b / 255 - 0.5) * contrastFactor + 0.5) * 255 + s.brightness))

        let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        if (s.invert) brightness = 1 - brightness

        if (!shouldDrawSketch(brightness, col, row, cols, rows, grid, s))
          continue

        const cx = offsetX + col * charWidth + charWidth / 2
        const cy = offsetY + row * charHeight + charHeight / 2

        switch (s.sketchStyle) {
          case "hatching":
            drawHatchingCell(cx, cy, brightness, r, g, b, charWidth, charHeight, s)
            break
          case "stipple":
            drawStippleCell(cx, cy, brightness, r, g, b, charWidth, charHeight, s)
            break
          case "mixed":
            if (brightness < 0.5) {
              drawHatchingCell(cx, cy, brightness, r, g, b, charWidth, charHeight, s)
            } else {
              drawStippleCell(cx, cy, brightness, r, g, b, charWidth, charHeight, s)
            }
            break
        }
      }
    }

    if (s.sketchStyle === "mixed") {
      drawContourLines(s)
    }

    p.pop()
    p.blendMode(p.BLEND)
  }

  // ============================================
  // p5 lifecycle
  // ============================================

  p.setup = () => {
    const { w, h } = getCanvasSize()
    p.createCanvas(w, h)
    p.noLoop()
    p.background(settingsRef.current?.bgColor ?? "#0a0a0f")
    drawPlaceholder()
  }

  function drawPlaceholder() {
    p.push()
    p.fill(100)
    p.textAlign(p.CENTER, p.CENTER)
    p.textSize(14)
    p.text("Drop an image to begin", p.width / 2, p.height / 2)
    p.pop()
  }

  p.windowResized = () => {
    const { w, h } = getCanvasSize()
    p.resizeCanvas(w, h)
    // Invalidate grid caches on resize
    brightnessGrid = null
    brightnessGridCols = 0
    brightnessGridRows = 0
    sizeGrid = null
    sizeGridCols = 0
    contourColorGrid = null
    contourGridWidth = 0
    contourGridHeight = 0
    p.redraw()
  }

  p.draw = () => {
    const s = settingsRef.current
    if (!s) return

    const img = imageRef.current
    if (!img) {
      p.background(s.bgColor)
      drawPlaceholder()
      p.noLoop()
      return
    }

    ensurePixelData(img, s.imageVersion)

    // Resize canvas if needed
    const { w, h } = getCanvasSize()
    if (Math.abs(p.width - w) > 1 || Math.abs(p.height - h) > 1) {
      p.resizeCanvas(w, h)
      brightnessGrid = null
      brightnessGridCols = 0
      brightnessGridRows = 0
      sizeGrid = null
      sizeGridCols = 0
        contourColorGrid = null
      contourGridWidth = 0
      contourGridHeight = 0
    }

    p.background(s.bgColor)

    // Draw original image overlay if enabled
    if (s.showOriginal) {
      const ctx = p.drawingContext as CanvasRenderingContext2D
      ctx.save()
      ctx.globalAlpha = s.originalOpacity / 100
      ctx.drawImage(img, 0, 0, p.width, p.height)
      ctx.restore()
    }

    // Draw sketch behind ASCII if configured
    if (
      s.sketchEnabled &&
      (s.sketchDrawOrder === "behind-ascii" || s.sketchDrawOrder === "both")
    ) {
      drawSketchElements(s)
    }

    // Draw ASCII art
    drawAsciiArt(s)

    // Draw sketch above ASCII if configured
    if (
      s.sketchEnabled &&
      (s.sketchDrawOrder === "above-ascii" || s.sketchDrawOrder === "both")
    ) {
      drawSketchElements(s)
    }

    // Apply texture effects
    applyTexture(s)
    applyGrain(s)

    p.noLoop()
  }
}
