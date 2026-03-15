# Studio

A unified design studio combining 9 generative art tools into a single web app.

**Tools:** Topo, Blocks, Organic, Dither, Gradients, Plotter, Metal Shader, ASCII, Lines

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Stack

- Vite + React 19 + TypeScript (strict mode)
- Tailwind CSS v4 + shadcn/ui
- p5.js (instance mode) for canvas tools
- Three.js for Metal Shader
- mp4-muxer for video export

## Project Structure

```
src/
├── components/       # Shared UI (shell, sidebar, controls)
├── hooks/            # useSettings, useP5, useThree, useFavicon
├── lib/              # Utilities (color, math, texture, export)
└── tools/            # One directory per tool
    └── <name>/
        ├── index.tsx   # React component (controls + canvas)
        ├── sketch.ts   # Rendering logic
        └── types.ts    # Settings type
```

Each tool is a lazy-loaded route (`/topo`, `/blocks`, etc.) with its own canvas renderer and settings sidebar.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npx tsc -b` | Type check |
| `npx vitest run` | Run tests |

## License

[MIT](LICENSE)
