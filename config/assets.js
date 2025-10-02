// Asset configuration defaults. Override by editing this object or
// replacing values at runtime before the game initializes.
window.ASSETS = {
  audio: {
    music: null, // Expected: small looping ambience (OGG/MP3). Keep <1 MB for quick start.
    hit: null, // Expected: short impact SFX (WAV/OGG). Prefer <100 KB.
    pickup: null // Expected: short pickup cue (WAV/OGG).
  },
  textures: {
    floor: null, // Expected: seamless square texture (<=512x512). PNG/JPG.
    wall: null, // Expected: seamless square texture (<=512x512). PNG/JPG.
    player: null, // Expected: sprite sheet or color map. PNG with alpha.
    monster: null // Expected: sprite sheet or color map. PNG with alpha.
  },
  models: {
    player: null, // Expected: glTF/GLB model. Keep poly count low (<5k) and atlas textures.
    monster: null // Expected: glTF/GLB model. Keep poly count low (<5k) and atlas textures.
  },
  postfx: {
    bloom: true // Preference: enable bloom when EffectComposer is wired (see main.js TODO).
  }
};

// TODO: Expand with additional slots (e.g., traps, props) and runtime asset validation.
