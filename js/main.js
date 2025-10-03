(function () {
  /**
   * The CDN build logs a warning (r150+) about UMD bundles being deprecated.
   * TODO: migrate to Three.js ES modules (e.g., import { Scene } from 'three') once we drop the no-build requirement.
   */
  function boot() {
    if (!window.THREE) {
      console.error("Three.js failed to load. Check CDN availability or network settings.");
      const container = document.getElementById("game-container");
      if (container) {
        container.textContent = "Three.js failed to load. Check console for details.";
      }
      return;
    }

    runGame();
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  function runGame() {
    const TILE_SIZE = 1.2;
    const MOVE_DELAY = 0.18; // seconds between grid steps

    let renderer;
    let scene;
    let camera;
    let game;
    let tileGroup;
    let monsterMeshes = new Map();
    let playerMesh;
    let animReq;
    let lastTimestamp = 0;
    let stepAccumulator = 0;
    let paused = false;
    let debugVisible = false;
    let audioMuted = true;
    let music;
    let musicReady = false;
    let fpsSmoothing = 0;
    let moveCooldown = 0;
    const moveQueue = [];
    const lighting = {};
    const monsterGeometry = createStarGeometry(TILE_SIZE * 0.6, TILE_SIZE * 0.3, TILE_SIZE * 0.25, 5);
    const monsterMaterial = new THREE.MeshStandardMaterial({
      color: 0x5ec5ff,
      emissive: 0x0a3254,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.1,
      flatShading: true
    });
    const PLAYER_EYE_OFFSET = TILE_SIZE * 0.1;
    const CAMERA_FOLLOW_OFFSET = new THREE.Vector3(6, 9, 6);
    const playerVisualPos = new THREE.Vector3();
    const playerDesiredPos = new THREE.Vector3();
    const cameraCurrentPos = new THREE.Vector3();
    const cameraTargetPos = new THREE.Vector3();
    const lookCurrent = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    const glowTarget = new THREE.Vector3();
    const monsterTarget = new THREE.Vector3();
    const monsterHeightTarget = new THREE.Vector3();
    const scratchVec = new THREE.Vector3();

    const inputState = {
      up: false,
      down: false,
      left: false,
      right: false
    };

    const container = document.getElementById("game-container");

    function createStarGeometry(outerRadius, innerRadius, thickness, points = 5) {
      const shape = new THREE.Shape();
      const step = Math.PI / points;
      for (let i = 0; i < points * 2; i += 1) {
        const angle = i * step - Math.PI / 2;
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) {
          shape.moveTo(x, y);
        } else {
          shape.lineTo(x, y);
        }
      }
      shape.closePath();

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false
      });
      geometry.center();
      geometry.rotateX(Math.PI / 2);
      geometry.computeVertexNormals();
      return geometry;
    }

    function init() {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      container.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x090512);

      camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

      const ambient = new THREE.HemisphereLight(0xa59cf0, 0x1c102e, 1.0);
      scene.add(ambient);
      lighting.ambient = ambient;

      const dirLight = new THREE.DirectionalLight(0xcac1ff, 0.85);
      dirLight.position.set(14, 20, 12);
      scene.add(dirLight);
      lighting.key = dirLight;

      const playerGlow = new THREE.PointLight(0x8e7cff, 1.3, 20, 2.4);
      playerGlow.position.set(0, 4, 0);
      scene.add(playerGlow);
      lighting.playerGlow = playerGlow;

      const fogColor = new THREE.Color(0x140c28);
      scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.028);

      game = window.GameLogic.createGame();

      const initialSnapshot = game.getSnapshot();
      rebuildWorld(initialSnapshot);
      initPlayerMesh(initialSnapshot);
      initMonsters(initialSnapshot);
      syncPresentation(initialSnapshot, true);
      syncMonsters(initialSnapshot, 1);

      window.UI.init({
        onResume: () => setPaused(false),
        onRestart: () => UI.showRestartConfirm(),
        onConfirmRestart: handleRestartChoice,
        onToggleAudio: toggleAudio
      });
      UI.setAudioMuted(audioMuted);

      prepareAudio();

      updateHUD();

      window.addEventListener("resize", onResize);
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      lastTimestamp = performance.now();
      animReq = requestAnimationFrame(loop);
    }

    function initPlayerMesh(snapshot) {
      const geom = new THREE.ConeGeometry(TILE_SIZE * 0.35, TILE_SIZE * 0.9, 4);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9b6dff, flatShading: true });
      playerMesh = new THREE.Mesh(geom, mat);
      playerMesh.rotation.y = Math.PI / 4;
      playerMesh.castShadow = false;
      scene.add(playerMesh);

      const initial = tileToWorld(snapshot.player.x, snapshot.player.y, scratchVec);
      playerVisualPos.set(initial.x, TILE_SIZE * 0.1, initial.z);
      cameraCurrentPos.set(initial.x + 6, initial.y + 9, initial.z + 6);
      lookCurrent.set(initial.x, initial.y - TILE_SIZE * 0.4, initial.z);
      playerMesh.position.copy(playerVisualPos);
      camera.position.copy(cameraCurrentPos);
      camera.lookAt(lookCurrent);
      if (lighting.playerGlow) {
        lighting.playerGlow.position.set(initial.x, 3.6, initial.z);
      }
    }

    function prepareAudio() {
      if (music) {
        return;
      }
      music = new Audio("assets/audio/music/DungeonEchoes.mp3");
      music.loop = true;
      music.volume = 0.2;
      music.preload = "auto";
      music.addEventListener("canplaythrough", () => {
        musicReady = true;
        if (!audioMuted) {
          playMusic();
        }
      }, { once: true });
      music.addEventListener("ended", () => {
        music.currentTime = 0;
        if (!audioMuted) {
          playMusic();
        }
      });
      if (music.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        musicReady = true;
      }
    }

    function playMusic() {
      if (!music) {
        return;
      }
      const start = () => {
        const promise = music.play();
        if (promise && typeof promise.catch === "function") {
          promise.catch((err) => {
            console.warn("Music playback blocked:", err);
            audioMuted = true;
            UI.setAudioMuted(true);
          });
        }
      };

      if (musicReady) {
        start();
      } else {
        music.addEventListener("canplaythrough", start, { once: true });
      }
    }

    function initMonsters(snapshot) {
      clearMonsters();
      for (const monster of snapshot.monsters) {
        const mesh = new THREE.Mesh(monsterGeometry, monsterMaterial);
        mesh.position.copy(tileToWorld(monster.x, monster.y));
        mesh.position.y += TILE_SIZE * 0.25;
        mesh.rotation.y = Math.random() * Math.PI * 2;
        scene.add(mesh);
        monsterMeshes.set(monster.id, mesh);
      }
    }

    function clearMonsters() {
      for (const mesh of monsterMeshes.values()) {
        scene.remove(mesh);
      }
      monsterMeshes.clear();
    }

    function rebuildWorld(snapshot) {
      if (tileGroup) {
        scene.remove(tileGroup);
      }

      tileGroup = new THREE.Group();
      const floorGeom = new THREE.BoxGeometry(TILE_SIZE, 0.1, TILE_SIZE);
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x4f3b86, roughness: 0.6, metalness: 0.05, flatShading: true });
      const stairMat = new THREE.MeshStandardMaterial({ color: 0x80d0ff, emissive: 0x1c3f63, emissiveIntensity: 0.9 });
      const wallGeom = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x2d1f4f, roughness: 0.75, metalness: 0.1, flatShading: true });
      const trapMat = new THREE.MeshStandardMaterial({ color: 0xd78eff, emissive: 0x5a1a92, emissiveIntensity: 1.15 });

      const { tiles } = snapshot;
      for (let y = 0; y < tiles.length; y += 1) {
        for (let x = 0; x < tiles[y].length; x += 1) {
          const tile = tiles[y][x];
          const worldPos = tileToWorld(x, y);
          const floor = new THREE.Mesh(floorGeom, floorMat);
          floor.position.copy(worldPos);
          floor.position.y -= TILE_SIZE * 0.5;
          tileGroup.add(floor);

          if (tile === GameLogic.TILE.WALL) {
            const wall = new THREE.Mesh(wallGeom, wallMat);
            wall.position.copy(worldPos);
            wall.position.y -= TILE_SIZE * 0.05;
            tileGroup.add(wall);
          } else if (tile === GameLogic.TILE.STAIRS_DOWN) {
            const stairs = new THREE.Mesh(floorGeom, stairMat);
            stairs.scale.set(0.7, 1, 0.7);
            stairs.position.copy(worldPos);
            stairs.position.y -= TILE_SIZE * 0.4;
            tileGroup.add(stairs);
          } else if (tile === GameLogic.TILE.TRAP_TRIGGERED) {
            const trap = new THREE.Mesh(floorGeom, trapMat);
            trap.scale.set(0.6, 1, 0.6);
            trap.position.copy(worldPos);
            trap.position.y -= TILE_SIZE * 0.45;
            tileGroup.add(trap);
          }
        }
      }

      // TODO: Replace walls/floors with instanced meshes or loaded assets once overrides exist.

      scene.add(tileGroup);
    }

    function tileToWorld(x, y, target) {
      if (!target) {
        target = new THREE.Vector3();
      }
      target.set(
        x * TILE_SIZE - (GameLogic.MAP.WIDTH * TILE_SIZE) / 2,
        0,
        y * TILE_SIZE - (GameLogic.MAP.HEIGHT * TILE_SIZE) / 2
      );
      return target;
    }

    function syncPresentation(snapshot, immediate = false) {
      tileToWorld(snapshot.player.x, snapshot.player.y, playerDesiredPos);

      cameraTargetPos.set(
        playerDesiredPos.x + CAMERA_FOLLOW_OFFSET.x,
        playerDesiredPos.y + CAMERA_FOLLOW_OFFSET.y,
        playerDesiredPos.z + CAMERA_FOLLOW_OFFSET.z
      );

      lookTarget.set(
        playerDesiredPos.x,
        playerDesiredPos.y - TILE_SIZE * 0.4,
        playerDesiredPos.z
      );

      glowTarget.set(playerDesiredPos.x, 3.6, playerDesiredPos.z);

      if (immediate) {
        playerVisualPos.set(playerDesiredPos.x, PLAYER_EYE_OFFSET, playerDesiredPos.z);
        playerMesh.position.copy(playerVisualPos);

        cameraCurrentPos.copy(cameraTargetPos);
        camera.position.copy(cameraCurrentPos);

        lookCurrent.copy(lookTarget);
        camera.lookAt(lookCurrent);

        if (lighting.playerGlow) {
          lighting.playerGlow.position.copy(glowTarget);
        }
      }
    }

    function updatePresentation(snapshot, delta) {
      // Update targets if player state changed since last frame.
      syncPresentation(snapshot, false);

      const lerpPlayer = Math.min(1, delta * 12);
      scratchVec.set(playerDesiredPos.x, PLAYER_EYE_OFFSET, playerDesiredPos.z);
      playerVisualPos.lerp(scratchVec, lerpPlayer);
      playerMesh.position.copy(playerVisualPos);

      const lerpCamera = Math.min(1, delta * 6);
      cameraCurrentPos.lerp(cameraTargetPos, lerpCamera);
      camera.position.copy(cameraCurrentPos);

      const lerpLook = Math.min(1, delta * 10);
      lookCurrent.lerp(lookTarget, lerpLook);
      camera.lookAt(lookCurrent);

      if (lighting.playerGlow) {
        lighting.playerGlow.position.lerp(glowTarget, Math.min(1, delta * 10));
      }
    }

    function loop(timestamp) {
      const delta = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (!paused) {
        stepAccumulator += delta;
        moveCooldown = Math.max(0, moveCooldown - delta);
        const fixedStep = 1 / 60;
        while (stepAccumulator >= fixedStep) {
          stepAccumulator -= fixedStep;
          processInput();
          game.update();
        }

        const snapshot = game.getSnapshot();
        updatePresentation(snapshot, delta);
        syncMonsters(snapshot, delta);
        updateHUD();
        updateDebug(delta, snapshot);
      }

      renderer.render(scene, camera);
      animReq = requestAnimationFrame(loop);
    }

    function processInput() {
      const direction = pollMove();
      if (!direction) {
        return;
      }
      game.handleMove(direction);
      const snapshot = game.getSnapshot();
      if (!snapshot.running) {
        setPaused(true);
      }
      if (snapshot.lastAction && snapshot.lastAction.type === "depth") {
        rebuildWorld(snapshot);
        initMonsters(snapshot);
        syncPresentation(snapshot, true);
        syncMonsters(snapshot, 1);
      }
    }

    function pollMove() {
      if (moveCooldown > 0) {
        return null;
      }
      if (moveQueue.length) {
        moveCooldown = MOVE_DELAY;
        return moveQueue.shift();
      }
      if (inputState.up) {
        moveCooldown = MOVE_DELAY;
        return GameLogic.DIRS.up;
      }
      if (inputState.down) {
        moveCooldown = MOVE_DELAY;
        return GameLogic.DIRS.down;
      }
      if (inputState.left) {
        moveCooldown = MOVE_DELAY;
        return GameLogic.DIRS.left;
      }
      if (inputState.right) {
        moveCooldown = MOVE_DELAY;
        return GameLogic.DIRS.right;
      }
      return null;
    }

    function syncMonsters(snapshot, delta) {
      const knownIds = new Set(monsterMeshes.keys());
      for (const monster of snapshot.monsters) {
        const mesh = monsterMeshes.get(monster.id);
        tileToWorld(monster.x, monster.y, monsterTarget);
        if (mesh) {
          monsterHeightTarget.set(monsterTarget.x, TILE_SIZE * 0.2, monsterTarget.z);
          const monsterLerp = Math.min(1, delta * 8);
          mesh.position.lerp(monsterHeightTarget, monsterLerp);
          mesh.rotation.y += delta * 1.2;
          knownIds.delete(monster.id);
        } else {
          const newMesh = new THREE.Mesh(monsterGeometry, monsterMaterial);
          newMesh.position.copy(monsterTarget);
          newMesh.position.y += TILE_SIZE * 0.25;
          newMesh.rotation.y = Math.random() * Math.PI * 2;
          scene.add(newMesh);
          monsterMeshes.set(monster.id, newMesh);
        }
      }

      for (const staleId of knownIds) {
        const mesh = monsterMeshes.get(staleId);
        if (mesh) {
          scene.remove(mesh);
        }
        monsterMeshes.delete(staleId);
      }
    }

    function updateHUD() {
      const snapshot = game.getSnapshot();
      UI.updateHUD({
        hp: snapshot.player.hp,
        hpMax: snapshot.player.hpMax,
        xp: snapshot.player.xp,
        xpMax: snapshot.player.xpMax,
        floor: snapshot.depth,
        keys: snapshot.player.keys,
        level: snapshot.player.lvl
      });
    }

    function updateDebug(delta, snapshot) {
      fpsSmoothing = fpsSmoothing * 0.9 + (1 / delta) * 0.1;
      if (debugVisible) {
        const telemetry = game.collectTelemetry();
        const lines = [
          `FPS: ${fpsSmoothing.toFixed(0)}`,
          `Depth: ${telemetry.depth}/${GameLogic.MAX_DEPTH}`,
          `HP: ${telemetry.hp}`,
          `XP: ${telemetry.xp}`,
          `Level: ${telemetry.lvl}`,
          `Keys: ${telemetry.keys}`,
          `Monsters: ${telemetry.monsters}`,
          `Running: ${telemetry.running}`,
          `Best: ${snapshot.bestScore}`
        ];
        UI.setDebug(lines.join("\n"));
      }
    }

    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function onKeyDown(event) {
      if (event.repeat) {
        return;
      }
      switch (event.code) {
        case "KeyW":
          inputState.up = true;
          moveQueue.push(GameLogic.DIRS.up);
          break;
        case "KeyS":
          inputState.down = true;
          moveQueue.push(GameLogic.DIRS.down);
          break;
        case "KeyA":
          inputState.left = true;
          moveQueue.push(GameLogic.DIRS.left);
          break;
        case "KeyD":
          inputState.right = true;
          moveQueue.push(GameLogic.DIRS.right);
          break;
        case "KeyP":
          setPaused(!paused);
          break;
        case "KeyR":
          UI.showRestartConfirm();
          break;
        case "Backquote":
          debugVisible = !debugVisible;
          UI.setDebugVisible(debugVisible);
          if (!debugVisible) {
            UI.setDebug("");
          }
          break;
        default:
          break;
      }
    }

    function onKeyUp(event) {
      switch (event.code) {
        case "KeyW":
          inputState.up = false;
          break;
        case "KeyS":
          inputState.down = false;
          break;
        case "KeyA":
          inputState.left = false;
          break;
        case "KeyD":
          inputState.right = false;
          break;
        default:
          break;
      }
    }

    function setPaused(value) {
      const snapshot = game.getSnapshot();
      if (!snapshot.running) {
        paused = value;
        UI.setPauseVisible(true);
        return;
      }
      paused = value;
      UI.setPauseVisible(paused);
    }

    function handleRestartChoice(confirmed) {
      if (confirmed) {
        game.restart();
        const snapshot = game.getSnapshot();
        rebuildWorld(snapshot);
        initMonsters(snapshot);
        syncPresentation(snapshot, true);
        syncMonsters(snapshot, 1);
        moveCooldown = 0;
        paused = false;
        UI.setPauseVisible(false);
        updateHUD();
      }
      UI.hideRestartConfirm();
    }

    function toggleAudio() {
      audioMuted = !audioMuted;
      UI.setAudioMuted(audioMuted);
      if (!music) {
        prepareAudio();
      }
      if (audioMuted) {
        if (music) {
          music.pause();
        }
      } else {
        playMusic();
      }
    }

    // Simple vignette/postFX placeholder.
    // TODO: Switch to ES modules and use EffectComposer + UnrealBloomPass when Bloom is enabled.
    // Steps: replace CDN script with `type="module"` import, create EffectComposer with RenderPass
    // and UnrealBloomPass, then render via composer in the loop.

    init();
  }
})();
