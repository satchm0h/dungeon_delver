(function () {
  function boot() {
    const THREE = window.THREE;
    const GameLogic = window.GameLogic;
    const UI = window.UI;
    if (!THREE || !GameLogic || !UI) {
      console.error("Required globals (THREE/GameLogic/UI) are missing. Ensure scripts are loaded in index.html.");
      const container = document.getElementById("game-container");
      if (container) {
        container.textContent = "Failed to initialize rendering modules.";
      }
      return;
    }

    const EffectComposer = THREE.EffectComposer || window.EffectComposer;
    const RenderPass = THREE.RenderPass || window.RenderPass;
    const UnrealBloomPass = THREE.UnrealBloomPass || window.UnrealBloomPass;
    if (!EffectComposer || !RenderPass || !UnrealBloomPass) {
      console.warn("Post-processing dependencies missing; continuing without bloom pipeline.");
    }

    runGame(THREE, GameLogic, UI, EffectComposer, RenderPass, UnrealBloomPass);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  function runGame(THREE, GameLogic, UI, EffectComposer, RenderPass, UnrealBloomPass) {
    const TILE_SIZE = 1.2;
    const MOVE_DELAY = 0.18; // seconds between grid steps
    const postProcessingAvailable = Boolean(EffectComposer && RenderPass && UnrealBloomPass);

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
    let swordHit;
    let swordHitReady = false;
    let fpsSmoothing = 0;
    let moveCooldown = 0;
    let composer;
    let renderPass;
    let bloomPass;
    let keyHoverClock = 0;
    let lastKnownHp = null;
    const moveQueue = [];
    const lighting = {};
    const monsterGeometry = createStarGeometry(TILE_SIZE * 0.6, TILE_SIZE * 0.3, TILE_SIZE * 0.25, 5);
    const monsterMaterial = new THREE.MeshStandardMaterial({
      color: 0x5ec5ff,
      emissive: 0x0a3254,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.1,
      flatShading: true,
      transparent: true,
      opacity: 0.95
    });
    const floorMeshes = new Map();
    const wallMeshes = new Map();
    const trapMeshes = new Map();
    const keyMeshes = new Map();
    const stairsMeshes = new Map();
    const visibleFloors = new Set();
    const visibleWalls = new Set();
    let visitedFlags = new Uint8Array(GameLogic.MAP.WIDTH * GameLogic.MAP.HEIGHT);
    const VISIBLE_RADIUS = 10;
    const WALKABLE_TILES = new Set([
      GameLogic.TILE.FLOOR,
      GameLogic.TILE.TRAP_HIDDEN,
      GameLogic.TILE.TRAP_TRIGGERED,
      GameLogic.TILE.STAIRS_DOWN,
      GameLogic.TILE.KEY
    ]);
    const BLOCKING_TILES = new Set([
      GameLogic.TILE.WALL,
      GameLogic.TILE.LOCKED_DOOR,
      GameLogic.TILE.SECRET_DOOR
    ]);
    const FLOOR_VISIBLE_COLOR = new THREE.Color(0x6b57d8);
    const FLOOR_HIDDEN_COLOR = new THREE.Color(0x05020c);
    const FLOOR_VISIBLE_EMISSIVE = new THREE.Color(0x251c55);
    const FLOOR_HIDDEN_EMISSIVE = new THREE.Color(0x000000);
    const WALL_VISIBLE_COLOR = new THREE.Color(0x342455);
    const WALL_HIDDEN_COLOR = new THREE.Color(0x020108);
    const WALL_VISIBLE_EMISSIVE = new THREE.Color(0x120a2a);
    const WALL_HIDDEN_EMISSIVE = new THREE.Color(0x000000);
    const TRAP_VISIBLE_COLOR = new THREE.Color(0x9f4dff);
    const TRAP_HIDDEN_COLOR = new THREE.Color(0x120220);
    const TRAP_VISIBLE_EMISSIVE = new THREE.Color(0x3a0c68);
    const TRAP_HIDDEN_EMISSIVE = new THREE.Color(0x000000);
    const STAIRS_VISIBLE_COLOR = new THREE.Color(0x74d1ff);
    const STAIRS_HIDDEN_COLOR = new THREE.Color(0x0a1a28);
    const STAIRS_VISIBLE_EMISSIVE = new THREE.Color(0x143342);
    const STAIRS_HIDDEN_EMISSIVE = new THREE.Color(0x000000);
    const KEY_BASE_COLOR = new THREE.Color(0xffd46a);
    const KEY_EMISSIVE_COLOR = new THREE.Color(0xffa63f);
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
      if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if ('outputEncoding' in renderer) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
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

      const playerGlow = new THREE.PointLight(0xffe6a8, 1.8, 18, 2.2);
      playerGlow.position.set(0, 4, 0);
      scene.add(playerGlow);
      lighting.playerGlow = playerGlow;

      const fogColor = new THREE.Color(0x140c28);
      scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.028);

      if (postProcessingAvailable) {
        composer = new EffectComposer(renderer);
        composer.setPixelRatio(window.devicePixelRatio || 1);
        composer.setSize(window.innerWidth, window.innerHeight);
        renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);
        bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.25, 0.6, 0.35);
        bloomPass.threshold = 0.65;
        bloomPass.strength = 1.2;
        bloomPass.radius = 0.5;
        composer.addPass(bloomPass);
      } else {
        composer = null;
        renderPass = null;
        bloomPass = null;
      }

      game = GameLogic.createGame();

      const initialSnapshot = game.getSnapshot();
      lastKnownHp = initialSnapshot.player.hp;
      rebuildWorld(initialSnapshot);
      initPlayerMesh(initialSnapshot);
      initMonsters(initialSnapshot);
      syncPresentation(initialSnapshot, true);
      syncMonsters(initialSnapshot, 1);
      updateVisibility(initialSnapshot);

      UI.init({
        onResume: () => setPaused(false),
        onRestart: () => UI.showRestartConfirm(),
        onConfirmRestart: handleRestartChoice,
        onToggleAudio: toggleAudio
      });
      UI.setAudioMuted(audioMuted);

      prepareAudio();

      updateHUD(initialSnapshot);

      window.addEventListener("resize", onResize);
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      lastTimestamp = performance.now();
      animReq = requestAnimationFrame(loop);
    }

    function initPlayerMesh(snapshot) {
      const geom = new THREE.ConeGeometry(TILE_SIZE * 0.35, TILE_SIZE * 0.9, 4);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffd36f,
        emissive: 0xffb347,
        emissiveIntensity: 0.25,
        roughness: 0.45,
        metalness: 0.08
      });
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
      if (!music) {
        music = new Audio("assets/audio/music/DungeonEchoes.mp3");
        music.loop = true;
        music.volume = 0.15;
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

      if (!swordHit) {
        swordHit = new Audio("assets/audio/effects/SwordHit.mp3");
        swordHit.volume = 0.6;
        swordHit.preload = "auto";
        swordHit.addEventListener("canplaythrough", () => {
          swordHitReady = true;
        }, { once: true });
        swordHit.addEventListener("ended", () => {
          swordHit.currentTime = 0;
        });
        if (swordHit.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
          swordHitReady = true;
        }
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

    function playSwordHit() {
      if (!swordHit || audioMuted) {
        return;
      }
      if (!swordHitReady) {
        return;
      }
      try {
        swordHit.currentTime = 0;
      } catch (err) {
        // Ignore seek issues (e.g., if not ready yet).
      }
      const promise = swordHit.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch((err) => {
          console.warn("Sword hit playback blocked:", err);
        });
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
      floorMeshes.clear();
      wallMeshes.clear();
      trapMeshes.clear();
      keyMeshes.clear();
      stairsMeshes.clear();

      const floorGeom = new THREE.BoxGeometry(TILE_SIZE, 0.1, TILE_SIZE);
      const wallGeom = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE);
      const stairsGeom = new THREE.BoxGeometry(TILE_SIZE, 0.1, TILE_SIZE);

      const baseFloorMat = new THREE.MeshStandardMaterial({
        color: FLOOR_HIDDEN_COLOR.clone(),
        roughness: 0.6,
        metalness: 0.05,
        flatShading: true,
        transparent: true,
        opacity: 0.12,
        emissive: FLOOR_HIDDEN_EMISSIVE.clone()
      });
      const baseWallMat = new THREE.MeshStandardMaterial({
        color: WALL_HIDDEN_COLOR.clone(),
        roughness: 0.75,
        metalness: 0.1,
        flatShading: true,
        transparent: true,
        opacity: 0.1,
        emissive: WALL_HIDDEN_EMISSIVE.clone()
      });
      const baseStairsMat = new THREE.MeshStandardMaterial({
        color: STAIRS_HIDDEN_COLOR.clone(),
        roughness: 0.4,
        metalness: 0.05,
        flatShading: true,
        transparent: true,
        opacity: 0.18,
        emissive: STAIRS_HIDDEN_EMISSIVE.clone()
      });

      const { tiles } = snapshot;
      for (let y = 0; y < tiles.length; y += 1) {
        for (let x = 0; x < tiles[y].length; x += 1) {
          const tile = tiles[y][x];
          const worldPos = tileToWorld(x, y);
          const key = tileKey(x, y);

          const floor = new THREE.Mesh(floorGeom, baseFloorMat.clone());
          floor.position.copy(worldPos);
          floor.position.y -= TILE_SIZE * 0.5;
          applyFloorVisibility(floor, false);
          floorMeshes.set(key, floor);
          tileGroup.add(floor);

          if (tile === GameLogic.TILE.WALL) {
            const wall = new THREE.Mesh(wallGeom, baseWallMat.clone());
            wall.position.copy(worldPos);
            wall.position.y -= TILE_SIZE * 0.05;
            applyWallVisibility(wall, false);
            wallMeshes.set(key, wall);
            tileGroup.add(wall);
          } else if (tile === GameLogic.TILE.STAIRS_DOWN) {
            const stairs = new THREE.Mesh(stairsGeom, baseStairsMat.clone());
            stairs.scale.set(0.7, 1, 0.7);
            stairs.position.copy(worldPos);
            stairs.position.y -= TILE_SIZE * 0.4;
            applyStairsVisibility(stairs, false);
            stairsMeshes.set(key, stairs);
            tileGroup.add(stairs);
          } else if (tile === GameLogic.TILE.TRAP_TRIGGERED) {
            ensureTrapMesh(x, y);
          }
        }
      }

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

    function tileKey(x, y) {
      return `${x},${y}`;
    }

    function tileIndex(x, y) {
      return y * GameLogic.MAP.WIDTH + x;
    }

    function applyFloorVisibility(mesh, visible) {
      if (!mesh) return;
      const material = mesh.material;
      if (!material) return;
      if (visible) {
        material.color.copy(FLOOR_VISIBLE_COLOR);
        material.emissive.copy(FLOOR_VISIBLE_EMISSIVE);
        material.opacity = 0.98;
        material.emissiveIntensity = 1.1;
      } else {
        material.color.copy(FLOOR_HIDDEN_COLOR);
        material.emissive.copy(FLOOR_HIDDEN_EMISSIVE);
        material.opacity = 0.03;
        material.emissiveIntensity = 0.0;
      }
      material.needsUpdate = true;
    }

    function applyWallVisibility(mesh, visible) {
      if (!mesh) return;
      const material = mesh.material;
      if (!material) return;
      if (visible) {
        material.color.copy(WALL_VISIBLE_COLOR);
        material.emissive.copy(WALL_VISIBLE_EMISSIVE);
        material.opacity = 0.75;
        material.emissiveIntensity = 0.7;
      } else {
        material.color.copy(WALL_HIDDEN_COLOR);
        material.emissive.copy(WALL_HIDDEN_EMISSIVE);
        material.opacity = 0.02;
        material.emissiveIntensity = 0.0;
      }
      material.needsUpdate = true;
    }

    function applyTrapVisibility(mesh, visible) {
      if (!mesh) return;
      const material = mesh.material;
      if (!material) return;
      if (visible) {
        material.color.copy(TRAP_VISIBLE_COLOR);
        material.emissive.copy(TRAP_VISIBLE_EMISSIVE);
        material.opacity = 0.9;
        material.emissiveIntensity = 1.25;
      } else {
        material.color.copy(TRAP_HIDDEN_COLOR);
        material.emissive.copy(TRAP_HIDDEN_EMISSIVE);
        material.opacity = 0.03;
        material.emissiveIntensity = 0.0;
      }
      material.needsUpdate = true;
    }

    function applyStairsVisibility(mesh, visible) {
      if (!mesh) return;
      const material = mesh.material;
      if (!material) return;
      if (visible) {
        material.color.copy(STAIRS_VISIBLE_COLOR);
        material.emissive.copy(STAIRS_VISIBLE_EMISSIVE);
        material.opacity = 0.95;
        material.emissiveIntensity = 1.35;
      } else {
        material.color.copy(STAIRS_HIDDEN_COLOR);
        material.emissive.copy(STAIRS_HIDDEN_EMISSIVE);
        material.opacity = 0.06;
        material.emissiveIntensity = 0.0;
      }
      material.needsUpdate = true;
    }

    function ensureTrapMesh(x, y) {
      const key = tileKey(x, y);
      let mesh = trapMeshes.get(key);
      const worldPos = tileToWorld(x, y, scratchVec);
      const targetY = worldPos.y - TILE_SIZE * 0.45;
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_SIZE, 0.1, TILE_SIZE),
          new THREE.MeshStandardMaterial({
            color: TRAP_HIDDEN_COLOR.clone(),
            roughness: 0.55,
            metalness: 0.2,
            flatShading: true,
            transparent: true,
            opacity: 0.12,
            emissive: TRAP_HIDDEN_EMISSIVE.clone()
          })
        );
        mesh.scale.set(0.6, 1, 0.6);
        mesh.position.set(worldPos.x, targetY, worldPos.z);
        applyTrapVisibility(mesh, false);
        trapMeshes.set(key, mesh);
        if (tileGroup) {
          tileGroup.add(mesh);
        }
      } else {
        mesh.position.set(worldPos.x, targetY, worldPos.z);
        if (mesh.parent !== tileGroup && tileGroup) {
          tileGroup.add(mesh);
        }
      }
      return mesh;
    }

    function syncTrapMeshes(snapshot) {
      if (!tileGroup) {
        return;
      }
      const required = new Set();
      const { tiles } = snapshot;
      for (let y = 0; y < tiles.length; y += 1) {
        for (let x = 0; x < tiles[y].length; x += 1) {
          if (tiles[y][x] === GameLogic.TILE.TRAP_TRIGGERED) {
            const key = tileKey(x, y);
            required.add(key);
            ensureTrapMesh(x, y);
          }
        }
      }
      const toRemove = [];
      for (const [key, mesh] of trapMeshes) {
        if (!required.has(key)) {
          tileGroup.remove(mesh);
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        trapMeshes.delete(key);
      }
    }

    function ensureKeyMesh(x, y) {
      const key = tileKey(x, y);
      let group = keyMeshes.get(key);
      const worldPos = tileToWorld(x, y, scratchVec);
      const baseY = worldPos.y - TILE_SIZE * 0.3;
      if (!group) {
        const ringGeometry = new THREE.TorusGeometry(TILE_SIZE * 0.22, TILE_SIZE * 0.055, 14, 24);
        const barGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.42, TILE_SIZE * 0.08, TILE_SIZE * 0.14);
        const materialA = new THREE.MeshStandardMaterial({
          color: KEY_BASE_COLOR.clone(),
          emissive: KEY_EMISSIVE_COLOR.clone(),
          emissiveIntensity: 1.4,
          roughness: 0.25,
          metalness: 0.6,
          transparent: true,
          opacity: 1
        });
        const materialB = materialA.clone();

        const ringMesh = new THREE.Mesh(ringGeometry, materialA);
        ringMesh.rotation.x = Math.PI / 2;

        const barMesh = new THREE.Mesh(barGeometry, materialB);
        barMesh.position.x = TILE_SIZE * 0.26;

        group = new THREE.Group();
        group.add(ringMesh);
        group.add(barMesh);
        group.position.set(worldPos.x, baseY, worldPos.z);
        group.rotation.y = Math.random() * Math.PI * 2;
        group.userData = {
          baseY,
          phase: Math.random() * Math.PI * 2
        };
        group.visible = false;
        keyMeshes.set(key, group);
        if (tileGroup) {
          tileGroup.add(group);
        }
      } else {
        group.position.set(worldPos.x, baseY, worldPos.z);
        if (group.parent !== tileGroup && tileGroup) {
          tileGroup.add(group);
        }
        group.userData.baseY = baseY;
      }
      return group;
    }

    function syncKeyMeshes(snapshot) {
      if (!tileGroup) {
        return;
      }
      const required = new Set();
      const { tiles } = snapshot;
      for (let y = 0; y < tiles.length; y += 1) {
        for (let x = 0; x < tiles[y].length; x += 1) {
          if (tiles[y][x] === GameLogic.TILE.KEY) {
            const key = tileKey(x, y);
            required.add(key);
            ensureKeyMesh(x, y);
          }
        }
      }
      const toRemove = [];
      for (const [key, mesh] of keyMeshes) {
        if (!required.has(key)) {
          if (mesh.parent) {
            mesh.parent.remove(mesh);
          }
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        keyMeshes.delete(key);
      }
    }

    function detectDamage(snapshot) {
      const hp = snapshot.player.hp;
      if (typeof lastKnownHp === "number" && hp < lastKnownHp) {
        UI.flashDamage(lastKnownHp - hp);
      }
      lastKnownHp = hp;
    }

    function handleGameEvents(events) {
      if (!events || !events.length) {
        return;
      }
      for (const event of events) {
        if (!event || typeof event !== "object") {
          continue;
        }
        if (event.type === "combat") {
          playSwordHit();
        }
      }
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

      keyHoverClock += delta;
      if (keyMeshes.size) {
        for (const mesh of keyMeshes.values()) {
          const data = mesh.userData || {};
          const baseY = typeof data.baseY === "number" ? data.baseY : mesh.position.y;
          const phase = data.phase || 0;
          mesh.rotation.y += delta * 2.4;
          mesh.position.y = baseY + Math.sin((keyHoverClock * 3) + phase) * TILE_SIZE * 0.12;
        }
      }
    }

    function updateVisibility(snapshot) {
      if (!snapshot || !snapshot.tiles || !snapshot.player) {
        return;
      }
      const tiles = snapshot.tiles;
      const player = snapshot.player;
      const width = GameLogic.MAP.WIDTH;
      const height = GameLogic.MAP.HEIGHT;

      if (visitedFlags.length !== width * height) {
        visitedFlags = new Uint8Array(width * height);
      }

      visibleFloors.clear();
      visibleWalls.clear();
      visitedFlags.fill(0);

      syncTrapMeshes(snapshot);
      syncKeyMeshes(snapshot);

      const queueX = [player.x];
      const queueY = [player.y];
      const queueDist = [0];
      let head = 0;
      if (player.x < 0 || player.x >= width || player.y < 0 || player.y >= height) {
        return;
      }
      visitedFlags[tileIndex(player.x, player.y)] = 1;

      const directions = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
      ];

      while (head < queueX.length) {
        const x = queueX[head];
        const y = queueY[head];
        const dist = queueDist[head];
        head += 1;

        visibleFloors.add(tileKey(x, y));

        if (dist >= VISIBLE_RADIUS) {
          continue;
        }

        for (const dir of directions) {
          const nx = x + dir.x;
          const ny = y + dir.y;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }

          const tile = tiles[ny][nx];
          const neighborKey = tileKey(nx, ny);

          if (BLOCKING_TILES.has(tile)) {
            if (tile === GameLogic.TILE.LOCKED_DOOR) {
              visibleFloors.add(neighborKey);
            }
            visibleWalls.add(neighborKey);
            continue;
          }

          if (!WALKABLE_TILES.has(tile)) {
            continue;
          }

          const idx = tileIndex(nx, ny);
          if (visitedFlags[idx]) {
            continue;
          }
          visitedFlags[idx] = 1;
          queueX.push(nx);
          queueY.push(ny);
          queueDist.push(dist + 1);
        }
      }

      for (const [key, mesh] of floorMeshes) {
        applyFloorVisibility(mesh, visibleFloors.has(key));
      }
      for (const [key, mesh] of wallMeshes) {
        applyWallVisibility(mesh, visibleWalls.has(key));
      }
      for (const [key, mesh] of trapMeshes) {
        applyTrapVisibility(mesh, visibleFloors.has(key));
      }
      for (const [key, mesh] of stairsMeshes) {
        applyStairsVisibility(mesh, visibleFloors.has(key));
      }
      for (const [key, mesh] of keyMeshes) {
        mesh.visible = visibleFloors.has(key);
      }

      const monsterPositions = new Map();
      for (const monster of snapshot.monsters) {
        monsterPositions.set(monster.id, tileKey(monster.x, monster.y));
      }
      for (const [id, mesh] of monsterMeshes) {
        const key = monsterPositions.get(id);
        mesh.visible = key ? visibleFloors.has(key) : false;
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

        const events = game.consumeEvents();
        if (events.length) {
          handleGameEvents(events);
        }

        const snapshot = game.getSnapshot();
        updatePresentation(snapshot, delta);
        syncMonsters(snapshot, delta);
        updateVisibility(snapshot);
        updateHUD(snapshot);
        detectDamage(snapshot);
        updateDebug(delta, snapshot);
      }

      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
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
        updateVisibility(snapshot);
        updateHUD(snapshot);
        lastKnownHp = snapshot.player.hp;
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

    function updateHUD(snapshot) {
      const data = snapshot || game.getSnapshot();
      UI.updateHUD({
        hp: data.player.hp,
        hpMax: data.player.hpMax,
        xp: data.player.xp,
        xpMax: data.player.xpMax,
        floor: data.depth,
        keys: data.player.keys,
        level: data.player.lvl
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
      if (composer) {
        composer.setSize(w, h);
        if (renderPass) {
          renderPass.camera = camera;
        }
        if (bloomPass) {
          bloomPass.setSize(w, h);
        }
      }
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
        lastKnownHp = snapshot.player.hp;
        rebuildWorld(snapshot);
        initMonsters(snapshot);
        syncPresentation(snapshot, true);
        syncMonsters(snapshot, 1);
        updateVisibility(snapshot);
        moveCooldown = 0;
        paused = false;
        UI.setPauseVisible(false);
        updateHUD(snapshot);
      }
      UI.hideRestartConfirm();
    }

    function toggleAudio() {
      audioMuted = !audioMuted;
      UI.setAudioMuted(audioMuted);
      prepareAudio();
      if (audioMuted) {
        if (music) {
          music.pause();
        }
        if (swordHit) {
          swordHit.pause();
          try {
            swordHit.currentTime = 0;
          } catch (err) {
            // ignore
          }
        }
      } else {
        playMusic();
      }
    }

    init();
}
})();
