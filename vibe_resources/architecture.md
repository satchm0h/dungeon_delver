# Dungeon Delver Architecture

This document summarizes the overall structure of the Dungeon Delver prototype, focusing on the current Three.js-based implementation.

## High-Level Overview

```mermaid
graph TD
  A[index.html] -->|loads| B[style.css]
  A --> C[config/assets.js]
  A --> D[js/game.js]
  A --> E[js/ui.js]
  A --> F[js/main.js]

  C --> F
  D --> F
  E --> F
  G[Three.js UMD + PostFX scripts] --> F

  F --> H[(Three.js Scene + Composer)]
  F --> I[(DOM HUD)]
```

- `index.html` links all runtime scripts and the stylesheet.
- `config/assets.js` defines configurable asset overrides (textures, models, audio) exposed via a global `ASSETS` object.
- `js/game.js` encapsulates mechanics, procedural generation, and state transitions.
- `js/ui.js` manages HUD elements, overlays, and debug readouts.
- `js/main.js` orchestrates rendering, fog-of-war visibility, input handling, audio, and the bridge between game logic and UI.

## Core Modules

### Game Logic (`js/game.js`)

The game module exposes a `GameLogic` namespace with constants and a factory, providing a clean interface to the rest of the app.

```mermaid
classDiagram
  class Game {
    +state
    +rng
    +bestScore
    +resetRun()
    +regenerateFloor()
    +handleMove(dir)
    +monsterTurn(events)
    +update()
    +collectTelemetry()
  }

  GameLogic <|-- Game
  GameLogic : +createGame()
  GameLogic : +TILE / DIRS / MAP / MAX_DEPTH
```

Key responsibilities:

- Procedural map generation with room carving, corridor linking (minimum-spanning approach + extra loops), trap/door/key sprinkling, and farthest-floor stair placement. Keys are always distributed in greater quantity than locked doors to avoid deadlocks.
- Turn-based movement: the player moves one tile per input, monsters respond in discrete turns using line-of-sight activation.
- Trap resolution deals immediate damage and converts the tile to its triggered variant; key tiles are consumed on contact and raise the player’s key inventory.
- Combat resolution, XP, leveling, and persistence for best floor reached.
- Collection of telemetry for debug overlays.

Supporting utilities: deterministic RNG (`mulberry32`), room helpers (`makeRoom`, `roomsOverlap`), BFS (`findFarthestFloor`), and monster stat scaling.

### UI Layer (`js/ui.js`)

Provides DOM references and basic setters:

- HUD updates for HP/XP bars, floor, keys, level, plus a brief damage flash overlay when HP drops.
- Pause & restart overlays, audio toggle button, and debug panel.
- Simple interface for external modules via `UI.init` with callbacks.

### Rendering & Input (`js/main.js`)

Responsibilities include:

- Loading Three.js via ES modules (import map) and re-exporting the expected globals before booting once the DOM is ready.
- Initializing the renderer with ACES tone mapping, the main scene/camera, and a bloom-enabled `EffectComposer` pipeline when the post-processing scripts are present (fallbacks to direct renderer output otherwise).
- Building tile meshes, rotating star-shaped monsters, the glowing cone player mesh, lazily instantiated triggered traps, and hovering key pickups with simple spin/hover animation.
- Maintaining smoothed presentation state (lerp-based for player/camera/glow) while querying discrete game snapshots.
- Running BFS visibility every frame to drive fog-of-war materials, monster visibility, and trap/key visibility within a 10-tile radius.
- Handling WASD movement, queueing inputs, synthesizing turn ticks, integrating HUD/audio toggles with combat hit SFX, and detecting HP loss to trigger the HUD damage flash.
- Managing a shared floor texture instance: the loader first honors any `ASSETS.textures.floor` override, otherwise tries the local asset, a GitHub-hosted fallback, and finally an inline data URI so the game still renders correctly when opened directly from disk (`file://`). Successful loads are cached and reused across all floor tiles to avoid redundant GPU uploads.

```mermaid
graph LR
  Input[W/A/S/D] -->|queue| MainLoop
  MainLoop -->|handleMove| Game:handleMove
  MainLoop -->|state snapshot| Game:getSnapshot
  Game -->|events| UI
  MainLoop -->|lerp| Renderer
  Velocity-->MainLoop
```

### Asset Configuration (`config/assets.js`)

Defines a global `ASSETS` object to allow future overrides:

- Textures, models, and audio slots default to `null` (procedural placeholders).
- Texture overrides can point at remote URLs; when omitted the runtime will fall back to built-in assets, including a baked-in floor tile texture exposed via `js/floor_texture_inline.js`.
- Post-processing preference (bloom) captured for future integration.
- Comments describe expected file formats and size guidelines.

## Data Flow Summary

1. **Initialization**: `main.js` loads config, game, and UI modules, sets up rendering, and starts the loop.
2. **Input**: Keyboard events populate a move queue processed during fixed updates (`1/60s`).
3. **Game Step**: `game.handleMove` and `game.monsterTurn` mutate state per turn; events (combat, traps, keys, doors, depth) are recorded.
4. **Presentation**: Each frame, `main.js` pulls a snapshot, smooths positions, updates meshes/HUD, and writes debug info.
5. **Persistence**: Depth progression updates `localStorage` (`bestScore`).

```mermaid
sequenceDiagram
  participant User
  participant Input
  participant Game
  participant Renderer
  participant Composer
  participant UI

  User->>Input: keydown (W/A/S/D)
  Input->>Game: queue direction
  Renderer->>Game: handleMove()
  Game-->>Renderer: snapshot/lastAction
  Renderer->>Renderer: lerp meshes & glow
  Renderer->>Renderer: BFS visibility (fog-of-war)
  Renderer->>Composer: render(scene, camera)
  Composer-->>Renderer: bloom-enhanced frame
  Renderer->>UI: updateHUD/debug
  Renderer->>Audio: toggle/play music (if unmuted)
```

## File Layout

```mermaid
graph TD
  root[/project root/]
  root --> assets
  assets --> audio
  audio --> music
  music --> file1[DungeonEchoes.mp3]
  root --> config
  config --> assetsjs[assets.js]
  root --> js
  js --> main[js/main.js]
  js --> game[js/game.js]
  js --> ui[js/ui.js]
  root --> vibe[vibe_resources]
  vibe --> placeholders[vibe_resources/placeholders.md]
  vibe --> arch[vibe_resources/architecture.md]
  root --> style[style.css]
  root --> index[index.html]
  index --> scripts[Three ES modules + postFX passes]
```

## Potential Future Features

- **Fog of War / Dynamic Lighting**: Implement a shader-driven vignette or light radius tied to the player.
- **Asset Overrides**: Auto-detect `ASSETS` URLs to swap models, textures, and sound effects at runtime.
- **Animation System**: Replace the placeholder player mesh with animated character models or sprite sheets.
- **Bloom & PostFX**: Switch to ES module builds and wire `EffectComposer` + `UnrealBloomPass` to honor the bloom preference.
- **Expanded Entities**: Add loot chests, ranged enemies, or environmental props to diversify dungeon layouts.
- **Settings Persistence**: Extend localStorage usage for audio/effects toggles and future accessibility options.
- **Save/Resume Runs**: Serialize deeper game state to allow mid-run saves.
