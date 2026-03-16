export type SetConfig = {
  standard: { enabled: boolean; weight: number }
  detailed: { enabled: boolean; weight: number }
  blocks: { enabled: boolean; weight: number }
  simple: { enabled: boolean; weight: number }
  dots: { enabled: boolean; weight: number }
  minimal: { enabled: boolean; weight: number }
}

export type HybridBlend = {
  random: number
  zone: number
  spatial: number
}

export type ZoneMapping = {
  dark: string
  mid: string
  light: string
}

export type SizeConfig = {
  minSize: number
  maxSize: number
  tileSize: number
  sizeSteps: number
}

export type SizeDetailSettings = {
  edgeSensitivity: number
  brightnessBias: number
  detailThreshold: number
}

export type SizeTextureSettings = {
  noiseScale: number
  noiseOctaves: number
  seed: number
}

export type SizeFocusSettings = {
  focusX: number
  focusY: number
  focusRadius: number
  falloffCurve: string
  centerSize: string
}

export type AsciiSettings = {
  // Characters
  charSet: string
  mixingEnabled: boolean
  mixingMode: string
  mixingSeed: number
  setConfig: SetConfig
  hybridBlend: HybridBlend
  zoneMapping: ZoneMapping
  spatialNoiseScale: number

  // Size Variation
  sizeVariationEnabled: boolean
  sizeVariationMode: string
  sizeConfig: SizeConfig
  sizeDetailSettings: SizeDetailSettings
  sizeTextureSettings: SizeTextureSettings
  sizeFocusSettings: SizeFocusSettings

  // Rendering
  fontSize: number
  letterSpacing: number
  lineHeight: number

  // Color
  useColors: boolean
  textColor: string
  colorSaturation: number
  bgColor: string

  // Overlay
  showOriginal: boolean
  originalOpacity: number
  asciiOpacity: number

  // Adjustments
  contrast: number
  brightness: number
  invert: boolean

  // Texture
  grainAmount: number
  textureAmount: number

  // Sketch
  sketchEnabled: boolean
  sketchStyle: string
  sketchDensity: number
  sketchWobble: number
  sketchStrokeWeight: number
  sketchOpacity: number

  // Sketch brightness reactivity
  sketchReactTo: string
  sketchMinThreshold: number
  sketchMaxThreshold: number
  sketchInvert: boolean

  // Sketch color
  sketchColorMatch: boolean
  sketchColor: string
  sketchColorVariation: number
  sketchSaturationBoost: number

  // Hatching
  hatchAngle: number
  hatchAngleVariation: number
  hatchLineLength: number
  hatchCrossHatch: boolean
  hatchCrossOpacity: number

  // Contour
  contourMinStrength: number
  contourEdgeSensitivity: number
  contourSmoothness: number
  contourFlowDirection: string

  // Stipple
  stippleDotSize: number
  stippleSizeVariation: number
  stippleClustering: number

  // Blocks
  blocksLevels: number
  blocksResolution: number
  blocksMinSize: number
  blocksSmoothing: number
  blocksFill: boolean
  blocksFillOpacity: number

  // Layer
  sketchDrawOrder: string
  sketchBlendMode: string

  // Internal
  imageVersion: number
}
