import type { DitherCell } from "./types"
import { ditherImage } from "./engine"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function svgShape(
  shape: string,
  cx: number,
  cy: number,
  cellSize: number,
  sizeFactor: number,
): string {
  const half = round2((cellSize / 2) * sizeFactor)
  cx = round2(cx)
  cy = round2(cy)

  switch (shape) {
    case "circle":
      return `<circle cx="${cx}" cy="${cy}" r="${half}"/>`
    case "square": {
      const x = round2(cx - half)
      const y = round2(cy - half)
      const s = round2(half * 2)
      return `<rect x="${x}" y="${y}" width="${s}" height="${s}"/>`
    }
    case "diamond": {
      const pts = [
        `${cx},${round2(cy - half)}`,
        `${round2(cx + half)},${cy}`,
        `${cx},${round2(cy + half)}`,
        `${round2(cx - half)},${cy}`,
      ].join(" ")
      return `<polygon points="${pts}"/>`
    }
    default:
      return ""
  }
}

export function generateDitherSvg(
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
    shape: string
  },
): string {
  if (!luminanceGrid) return ""

  const cellSize = settings.cellSize
  const dithered: DitherCell[][] = ditherImage(
    luminanceGrid,
    cols,
    rows,
    settings,
  )

  const width = cols * cellSize
  const height = rows * cellSize

  // Group cells by color
  const groups: Record<number, { cx: number; cy: number; sizeFactor: number }[]> = {}
  for (let i = 0; i < settings.palette.length; i++) {
    groups[i] = []
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = dithered[y][x]
      if (cell.colorIndex === settings.palette.length - 1) continue

      const cx = x * cellSize + cellSize / 2
      const cy = y * cellSize + cellSize / 2
      const sizeFactor = settings.style === "scaled" ? cell.size : 1.0

      if (sizeFactor < 0.01) continue

      groups[cell.colorIndex].push({ cx, cy, sizeFactor })
    }
  }

  const bgColor = settings.palette[settings.palette.length - 1]
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
  svg += `  <rect width="100%" height="100%" fill="${bgColor}"/>\n`

  for (let i = 0; i < settings.palette.length - 1; i++) {
    const cells = groups[i]
    if (cells.length === 0) continue

    svg += `  <g fill="${settings.palette[i]}" id="color-${i}">\n`
    for (const cell of cells) {
      svg +=
        "    " +
        svgShape(settings.shape, cell.cx, cell.cy, cellSize, cell.sizeFactor) +
        "\n"
    }
    svg += "  </g>\n"
  }

  svg += "</svg>"
  return svg
}
