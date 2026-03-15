import type { PaletteColor } from "@/types/tools"

export type DitherSettings = {
  // Source
  sourceType: "image" | "gradient"
  gradientType: "linear" | "radial" | "conic" | "noise"
  gradientAngle: number
  aspectRatio: string
  gradientWidth: number
  gradientHeight: number

  // Pattern
  pattern:
    | "bayer2"
    | "bayer4"
    | "bayer8"
    | "halftone"
    | "lines"
    | "crosses"
    | "dots"
    | "grid"
    | "scales"
  ditherMode: "image" | "linear" | "radial"
  ditherStyle: "threshold" | "scaled"
  shapeType: "circle" | "square" | "diamond"

  // Parameters
  cellSize: number
  angle: number
  scale: number
  offsetX: number
  offsetY: number

  // Palette
  colors: PaletteColor[]
}

export type DitherCell = {
  colorIndex: number
  size: number
}
