import { useCallback, useEffect, useRef, useState } from "react"
import type { PaletteColor } from "@/types/tools"
import { useSettings } from "@/hooks/use-settings"
import { CanvasArea } from "@/components/canvas-area"
import { Sidebar } from "@/components/sidebar"
import { Section } from "@/components/controls/section"
import { SliderControl } from "@/components/controls/slider-control"
import { SelectControl } from "@/components/controls/select-control"
import { PaletteEditor } from "@/components/controls/palette-editor"
import { ButtonRow } from "@/components/controls/button-row"
import { Button } from "@/components/ui/button"
import { exportPNG, exportSVG, generateFilename } from "@/lib/export"
import type { DitherSettings } from "./types"
import {
  generateGradientGrid,
  ditherImage,
  processImageToGrid,
  renderDither,
} from "./engine"
import { generateDitherSvg } from "./svg"

const GAMEBOY_PRESET: PaletteColor[] = [
  { color: "#0f380f", weight: 1 },
  { color: "#306230", weight: 1 },
  { color: "#8bac0f", weight: 1 },
  { color: "#9bbc0f", weight: 1 },
]

const PALETTE_PRESETS = [
  {
    name: "B&W",
    colors: [
      { color: "#000000", weight: 1 },
      { color: "#ffffff", weight: 1 },
    ],
  },
  { name: "Game Boy", colors: GAMEBOY_PRESET },
  {
    name: "CGA",
    colors: [
      { color: "#000000", weight: 1 },
      { color: "#55ffff", weight: 1 },
      { color: "#ff55ff", weight: 1 },
      { color: "#ffffff", weight: 1 },
    ],
  },
  {
    name: "Sepia",
    colors: [
      { color: "#2b1d0e", weight: 1 },
      { color: "#6b4226", weight: 1 },
      { color: "#c4956a", weight: 1 },
      { color: "#f5e6c8", weight: 1 },
    ],
  },
]

const DEFAULTS: DitherSettings = {
  sourceType: "gradient",
  gradientType: "linear",
  gradientAngle: 45,
  aspectRatio: "1:1",
  gradientWidth: 512,
  gradientHeight: 512,
  pattern: "bayer4",
  ditherMode: "image",
  ditherStyle: "threshold",
  shapeType: "square",
  cellSize: 8,
  angle: 45,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  colors: GAMEBOY_PRESET,
}

const PATTERN_OPTIONS = [
  { value: "bayer2", label: "Bayer 2x2" },
  { value: "bayer4", label: "Bayer 4x4" },
  { value: "bayer8", label: "Bayer 8x8" },
  { value: "halftone", label: "Halftone" },
  { value: "lines", label: "Lines" },
  { value: "crosses", label: "Crosses" },
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
  { value: "scales", label: "Scales" },
]

const ASPECT_OPTIONS = [
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "3:2", label: "3:2" },
  { value: "custom", label: "Custom" },
]

function getGradientHeight(
  width: number,
  aspectRatio: string,
  customHeight: number,
): number {
  if (aspectRatio === "custom") return customHeight
  const [rw, rh] = aspectRatio.split(":").map(Number)
  return Math.round((width * rh) / rw)
}

export default function Dither() {
  const [settings, update] = useSettings<DitherSettings>("dither", DEFAULTS)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourceImageRef = useRef<HTMLImageElement | null>(null)
  const gridRef = useRef<{
    grid: number[][]
    cols: number
    rows: number
  } | null>(null)
  // Counter to force re-render after grid changes (refs don't trigger renders)
  const [gridVersion, setGridVersion] = useState(0)

  const buildEngineSettings = useCallback((s: DitherSettings) => {
    const totalWeight = s.colors.reduce((sum, c) => sum + c.weight, 0)
    const percentages = s.colors.map((c) => (c.weight / totalWeight) * 100)
    const palette = s.colors.map((c) => c.color)
    return {
      pattern: s.pattern,
      mode: s.ditherMode,
      style: s.ditherStyle,
      shape: s.shapeType,
      cellSize: s.cellSize,
      angle: s.angle,
      scale: s.scale,
      offsetX: s.offsetX,
      offsetY: s.offsetY,
      palette,
      percentages,
    }
  }, [])

  // Render dithered result to canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current
    const g = gridRef.current
    if (!canvas || !g) return

    const engineSettings = buildEngineSettings(settings)
    const dithered = ditherImage(g.grid, g.cols, g.rows, engineSettings)

    const width = g.cols * settings.cellSize
    const height = g.rows * settings.cellSize
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")!
    renderDither(ctx, dithered, g.cols, g.rows, engineSettings)
  }, [settings, buildEngineSettings])

  // Generate gradient grid and trigger re-render
  const generateGrid = useCallback(() => {
    const h = getGradientHeight(
      settings.gradientWidth,
      settings.aspectRatio,
      settings.gradientHeight,
    )
    gridRef.current = generateGradientGrid(
      settings.gradientType,
      settings.gradientWidth,
      settings.cellSize,
      h,
      settings.gradientAngle,
    )
    sourceImageRef.current = null
    setGridVersion((v) => v + 1)
  }, [
    settings.gradientType,
    settings.gradientWidth,
    settings.gradientHeight,
    settings.aspectRatio,
    settings.gradientAngle,
    settings.cellSize,
  ])

  // Re-generate source when source params change
  useEffect(() => {
    if (settings.sourceType === "gradient") {
      generateGrid()
    } else if (sourceImageRef.current) {
      gridRef.current = processImageToGrid(
        sourceImageRef.current,
        settings.cellSize,
      )
      setGridVersion((v) => v + 1)
    }
  }, [
    settings.sourceType,
    settings.gradientType,
    settings.gradientWidth,
    settings.gradientHeight,
    settings.aspectRatio,
    settings.gradientAngle,
    settings.cellSize,
    generateGrid,
  ])

  // Re-render when settings or grid version changes
  useEffect(() => {
    render()
  }, [render, gridVersion])

  // Image upload handler
  const handleImageFile = useCallback(
    (file: File) => {
      const img = new Image()
      img.onload = () => {
        sourceImageRef.current = img
        gridRef.current = processImageToGrid(img, settings.cellSize)
        update({ sourceType: "image" })
        setGridVersion((v) => v + 1)
      }
      img.src = URL.createObjectURL(file)
    },
    [update, settings.cellSize],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file && file.type.startsWith("image/")) {
        handleImageFile(file)
      }
    },
    [handleImageFile],
  )

  const handleExportPNG = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width) return
    exportPNG(canvas, generateFilename("dither", "png"))
  }, [])

  const handleExportSVG = useCallback(() => {
    const g = gridRef.current
    if (!g) return
    const engineSettings = buildEngineSettings(settings)
    const svg = generateDitherSvg(g.grid, g.cols, g.rows, engineSettings)
    if (svg) exportSVG(svg, generateFilename("dither", "svg"))
  }, [settings, buildEngineSettings])

  return (
    <>
      <Sidebar
        footer={
          <ButtonRow>
            <Button
              variant="primary"
              className="w-full"
              onClick={handleExportSVG}
            >
              Export SVG
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleExportPNG}
            >
              Export PNG
            </Button>
          </ButtonRow>
        }
      >
        <h2 className="mb-3 text-sm font-medium text-text-primary">Dither</h2>
        <div className="flex flex-col gap-4">
          <Section title="Source">
            <SelectControl
              label="Source"
              value={settings.sourceType}
              options={[
                { value: "image", label: "Image" },
                { value: "gradient", label: "Gradient" },
              ]}
              onChange={(v) =>
                update({ sourceType: v as "image" | "gradient" })
              }
            />
            {settings.sourceType === "image" && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImageFile(file)
                  }}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Load Image
                </Button>
              </>
            )}
            {settings.sourceType === "gradient" && (
              <>
                <SelectControl
                  label="Type"
                  value={settings.gradientType}
                  options={[
                    { value: "linear", label: "Linear" },
                    { value: "radial", label: "Radial" },
                    { value: "conic", label: "Conic" },
                    { value: "noise", label: "Noise" },
                  ]}
                  onChange={(v) =>
                    update({
                      gradientType: v as DitherSettings["gradientType"],
                    })
                  }
                />
                {settings.gradientType !== "radial" &&
                  settings.gradientType !== "noise" && (
                    <SliderControl
                      label="Angle"
                      value={settings.gradientAngle}
                      min={0}
                      max={360}
                      step={1}
                      unit="°"
                      onChange={(v) => update({ gradientAngle: v })}
                    />
                  )}
                <SelectControl
                  label="Aspect Ratio"
                  value={settings.aspectRatio}
                  options={ASPECT_OPTIONS}
                  onChange={(v) => update({ aspectRatio: v })}
                />
                <SliderControl
                  label="Width"
                  value={settings.gradientWidth}
                  min={256}
                  max={2048}
                  step={64}
                  unit="px"
                  onChange={(v) => update({ gradientWidth: v })}
                />
                {settings.aspectRatio === "custom" && (
                  <SliderControl
                    label="Height"
                    value={settings.gradientHeight}
                    min={256}
                    max={2048}
                    step={64}
                    unit="px"
                    onChange={(v) => update({ gradientHeight: v })}
                  />
                )}
              </>
            )}
          </Section>

          <Section title="Pattern">
            <SelectControl
              label="Pattern"
              value={settings.pattern}
              options={PATTERN_OPTIONS}
              onChange={(v) =>
                update({ pattern: v as DitherSettings["pattern"] })
              }
            />
            <SelectControl
              label="Dither Mode"
              value={settings.ditherMode}
              options={[
                { value: "image", label: "Image" },
                { value: "linear", label: "Linear" },
                { value: "radial", label: "Radial" },
              ]}
              onChange={(v) =>
                update({ ditherMode: v as DitherSettings["ditherMode"] })
              }
            />
            <SelectControl
              label="Dither Style"
              value={settings.ditherStyle}
              options={[
                { value: "threshold", label: "Threshold" },
                { value: "scaled", label: "Scaled" },
              ]}
              onChange={(v) =>
                update({ ditherStyle: v as DitherSettings["ditherStyle"] })
              }
            />
            <SelectControl
              label="Shape"
              value={settings.shapeType}
              options={[
                { value: "circle", label: "Circle" },
                { value: "square", label: "Square" },
                { value: "diamond", label: "Diamond" },
              ]}
              onChange={(v) =>
                update({ shapeType: v as DitherSettings["shapeType"] })
              }
            />
          </Section>

          <Section title="Parameters">
            <SliderControl
              label="Cell Size"
              value={settings.cellSize}
              min={2}
              max={32}
              step={1}
              unit="px"
              onChange={(v) => update({ cellSize: v })}
            />
            {settings.ditherMode === "linear" && (
              <SliderControl
                label="Angle"
                value={settings.angle}
                min={0}
                max={360}
                step={1}
                unit="°"
                onChange={(v) => update({ angle: v })}
              />
            )}
            {settings.ditherMode === "radial" && (
              <>
                <SliderControl
                  label="Scale"
                  value={settings.scale}
                  min={10}
                  max={200}
                  step={1}
                  unit="%"
                  onChange={(v) => update({ scale: v })}
                />
                <SliderControl
                  label="Offset X"
                  value={settings.offsetX}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(v) => update({ offsetX: v })}
                />
                <SliderControl
                  label="Offset Y"
                  value={settings.offsetY}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(v) => update({ offsetY: v })}
                />
              </>
            )}
          </Section>

          <Section title="Palette">
            <PaletteEditor
              colors={settings.colors}
              onChange={(colors) => update({ colors })}
              presets={PALETTE_PRESETS}
            />
          </Section>
        </div>
      </Sidebar>
      <CanvasArea onDragOver={handleDragOver} onDrop={handleDrop}>
        <canvas
          ref={canvasRef}
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      </CanvasArea>
    </>
  )
}
