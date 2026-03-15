import type { PaletteColor } from "@/types/tools"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"

interface PaletteEditorProps {
  colors: PaletteColor[]
  onChange: (colors: PaletteColor[]) => void
  presets?: { name: string; colors: PaletteColor[] }[]
}

export function PaletteEditor({
  colors,
  onChange,
  presets,
}: PaletteEditorProps) {
  const totalWeight = colors.reduce((sum, c) => sum + c.weight, 0)

  const updateColor = (index: number, patch: Partial<PaletteColor>) => {
    const next = colors.map((c, i) => (i === index ? { ...c, ...patch } : c))
    onChange(next)
  }

  const removeColor = (index: number) => {
    if (colors.length <= 1) return
    onChange(colors.filter((_, i) => i !== index))
  }

  const addColor = () => {
    onChange([...colors, { color: "#ffffff", weight: 1 }])
  }

  return (
    <div className="flex flex-col gap-2">
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <Button
              key={preset.name}
              variant="secondary"
              size="sm"
              onClick={() => onChange(preset.colors)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      )}
      {colors.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="color"
            value={entry.color}
            onChange={(e) => updateColor(i, { color: e.target.value })}
            className="h-7 w-7 shrink-0 cursor-pointer appearance-none rounded-md border border-border-control bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none"
          />
          <input
            type="text"
            value={entry.color}
            onChange={(e) => {
              const val = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                updateColor(i, { color: val })
              }
            }}
            className="w-[58px] shrink-0 rounded-md border border-border-control bg-transparent px-1.5 py-1 font-mono text-2xs text-text-secondary outline-none"
          />
          <div className="flex-1">
            <Slider
              value={[entry.weight]}
              min={0}
              max={10}
              step={0.1}
              onValueChange={([w]) => updateColor(i, { weight: w })}
            />
          </div>
          <span className="w-7 shrink-0 text-right font-mono text-2xs tabular-nums text-text-tertiary">
            {totalWeight > 0
              ? Math.round((entry.weight / totalWeight) * 100)
              : 0}
            %
          </span>
          {colors.length > 1 && (
            <button
              onClick={() => removeColor(i)}
              className="shrink-0 cursor-pointer text-2xs text-text-tertiary hover:text-text-secondary"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addColor}>
        Add color
      </Button>
    </div>
  )
}
