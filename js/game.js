(function () {
  const TILE = {
    VOID: 0,
    FLOOR: 1,
    WALL: 2,
    LOCKED_DOOR: 3,
    SECRET_DOOR: 4,
    TRAP_HIDDEN: 5,
    TRAP_TRIGGERED: 6,
    STAIRS_DOWN: 7,
    KEY: 8
  };

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  const MAP = {
    WIDTH: 41,
    HEIGHT: 41
  };

  const MAX_DEPTH = 100;
  const MONSTER_VIEW_RANGE = 9;
  const LOCAL_STORAGE_KEY = "bestScore";

  let monsterIdCounter = 0;

  function randomInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRoom(x, y, w, h) {
    return {
      x,
      y,
      w,
      h,
      cx: Math.floor(x + w / 2),
      cy: Math.floor(y + h / 2)
    };
  }

  function roomsOverlap(a, b, padding) {
    return !(
      a.x + a.w + padding <= b.x ||
      b.x + b.w + padding <= a.x ||
      a.y + a.h + padding <= b.y ||
      b.y + b.h + padding <= a.y
    );
  }

  function roomDistanceSq(a, b) {
    const dx = a.cx - b.cx;
    const dy = a.cy - b.cy;
    return dx * dx + dy * dy;
  }

  function makeEmptyMap() {
    const tiles = new Array(MAP.HEIGHT);
    for (let y = 0; y < MAP.HEIGHT; y += 1) {
      tiles[y] = new Array(MAP.WIDTH).fill(TILE.WALL);
    }
    return tiles;
  }

  function isWalkable(tile) {
    return (
      tile === TILE.FLOOR ||
      tile === TILE.TRAP_HIDDEN ||
      tile === TILE.TRAP_TRIGGERED ||
      tile === TILE.KEY ||
      tile === TILE.STAIRS_DOWN
    );
  }

  function isOpaque(tile) {
    return tile === TILE.WALL || tile === TILE.LOCKED_DOOR;
  }

  function hasLineOfSight(ax, ay, bx, by, tiles, maxRange) {
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    if (dx + dy > maxRange) {
      return false;
    }
    let x = ax;
    let y = ay;
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx - dy;

    while (!(x === bx && y === by)) {
      if (!(x === ax && y === ay)) {
        const tile = tiles[y][x];
        if (isOpaque(tile)) {
          return false;
        }
      }
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return true;
  }

  function createPlayer() {
    return {
      x: 1,
      y: 1,
      hp: 18,
      hpMax: 18,
      xp: 0,
      xpMax: 15,
      lvl: 1,
      keys: 0
    };
  }

  function calcMonsterStats(depth) {
    const base = 6 + depth * 0.6;
    return {
      hp: Math.round(4 + depth * 0.4),
      dmg: Math.round(2 + depth * 0.35),
      xp: Math.round(base)
    };
  }

  function placeRooms(rng, tiles, depth) {
    const rooms = [];
    const targetRooms = Math.min(20, 12 + Math.floor(depth / 4));
    const maxAttempts = 240;
    let attempts = 0;

    while (attempts < maxAttempts && rooms.length < targetRooms) {
      attempts += 1;
      const w = randomInt(rng, 6, 10);
      const h = randomInt(rng, 6, 10);
      const x = randomInt(rng, 1, MAP.WIDTH - w - 2);
      const y = randomInt(rng, 1, MAP.HEIGHT - h - 2);
      const candidate = makeRoom(x, y, w, h);

      if (rooms.some((existing) => roomsOverlap(existing, candidate, 2))) {
        continue;
      }

      rooms.push(candidate);
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
          tiles[yy][xx] = TILE.FLOOR;
        }
      }
    }

    return rooms;
  }

  function connectRooms(rng, tiles, rooms) {
    if (rooms.length <= 1) {
      return;
    }

    const connected = new Set([0]);
    const remaining = new Set();
    for (let i = 1; i < rooms.length; i += 1) {
      remaining.add(i);
    }

    const carve = (roomA, roomB) => {
      const startX = roomA.cx;
      const startY = roomA.cy;
      const endX = roomB.cx;
      const endY = roomB.cy;
      const horizontalFirst = rng() < 0.5;

      if (horizontalFirst) {
        carveHorizontal(tiles, startY, startX, endX);
        carveVertical(tiles, endX, startY, endY);
      } else {
        carveVertical(tiles, startX, startY, endY);
        carveHorizontal(tiles, endY, startX, endX);
      }
    };

    const carveHorizontal = (tiles, y, x1, x2) => {
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      for (let x = minX; x <= maxX; x += 1) {
        tiles[y][x] = TILE.FLOOR;
        if (y + 1 < MAP.HEIGHT) tiles[y + 1][x] = tiles[y + 1][x] === TILE.WALL ? TILE.FLOOR : tiles[y + 1][x];
        if (y - 1 >= 0) tiles[y - 1][x] = tiles[y - 1][x] === TILE.WALL ? TILE.FLOOR : tiles[y - 1][x];
      }
    };

    const carveVertical = (tiles, x, y1, y2) => {
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      for (let y = minY; y <= maxY; y += 1) {
        tiles[y][x] = TILE.FLOOR;
        if (x + 1 < MAP.WIDTH) tiles[y][x + 1] = tiles[y][x + 1] === TILE.WALL ? TILE.FLOOR : tiles[y][x + 1];
        if (x - 1 >= 0) tiles[y][x - 1] = tiles[y][x - 1] === TILE.WALL ? TILE.FLOOR : tiles[y][x - 1];
      }
    };

    while (remaining.size) {
      let bestFrom = null;
      let bestTo = null;
      let bestDist = Infinity;

      for (const fromIdx of connected) {
        const fromRoom = rooms[fromIdx];
        for (const toIdx of remaining) {
          const toRoom = rooms[toIdx];
          const dist = roomDistanceSq(fromRoom, toRoom);
          if (dist < bestDist) {
            bestDist = dist;
            bestFrom = fromIdx;
            bestTo = toIdx;
          }
        }
      }

      if (bestTo === null) {
        break;
      }

      carve(rooms[bestFrom], rooms[bestTo]);
      connected.add(bestTo);
      remaining.delete(bestTo);
    }

    // Add a few extra random connections for loops.
    const extraConnections = Math.max(1, Math.floor(rooms.length / 4));
    for (let i = 0; i < extraConnections; i += 1) {
      const aIdx = randomInt(rng, 0, rooms.length - 1);
      let bIdx = randomInt(rng, 0, rooms.length - 1);
      if (rooms.length > 1) {
        while (bIdx === aIdx) {
          bIdx = randomInt(rng, 0, rooms.length - 1);
        }
      }
      carve(rooms[aIdx], rooms[bIdx]);
    }
  }

  function sprinkleFeatures(rng, tiles, depth, rooms, spawn) {
    const candidates = [];
    for (let y = 1; y < MAP.HEIGHT - 1; y += 1) {
      for (let x = 1; x < MAP.WIDTH - 1; x += 1) {
        if (tiles[y][x] === TILE.FLOOR) {
          if (spawn && Math.abs(spawn.x - x) + Math.abs(spawn.y - y) <= 2) {
            continue;
          }
          candidates.push({ x, y });
        }
      }
    }

    const trapCount = Math.min(12, 4 + Math.floor(depth / 3));

    shuffleInPlace(rng, candidates);

    function placeFeature(pool, count, mutator) {
      let placed = 0;
      let guard = pool.length * 3;
      while (placed < count && pool.length && guard > 0) {
        guard -= 1;
        const tile = pool.pop();
        if (!tile) {
          break;
        }
        if (tiles[tile.y][tile.x] !== TILE.FLOOR) {
          continue;
        }
        mutator(tile);
        placed += 1;
      }
    }

    placeFeature(candidates, trapCount, (tile) => {
      tiles[tile.y][tile.x] = TILE.TRAP_HIDDEN;
    });
  }

  function shuffleInPlace(rng, array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function findFloorTile(rng, tiles) {
    const opts = [];
    for (let y = 1; y < MAP.HEIGHT - 1; y += 1) {
      for (let x = 1; x < MAP.WIDTH - 1; x += 1) {
        if (tiles[y][x] === TILE.FLOOR) {
          opts.push({ x, y });
        }
      }
    }
    if (!opts.length) {
      return { x: 1, y: 1 };
    }
    return opts[Math.floor(rng() * opts.length)];
  }

  function findFarthestFloor(tiles, startX, startY) {
    const visited = new Array(MAP.HEIGHT);
    for (let y = 0; y < MAP.HEIGHT; y += 1) {
      visited[y] = new Array(MAP.WIDTH).fill(false);
    }

    let farthest = { x: startX, y: startY, dist: 0 };
    const queue = [{ x: startX, y: startY, dist: 0 }];
    visited[startY][startX] = true;
    let head = 0;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;

      if (current.dist > farthest.dist) {
        farthest = current;
      }

      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 }
      ];

      for (const n of neighbors) {
        if (!n || n.x < 0 || n.x >= MAP.WIDTH || n.y < 0 || n.y >= MAP.HEIGHT) {
          continue;
        }
        if (visited[n.y][n.x]) {
          continue;
        }
        const tile = tiles[n.y][n.x];
        if (tile === TILE.WALL) {
          continue;
        }
        visited[n.y][n.x] = true;
        queue.push({ x: n.x, y: n.y, dist: current.dist + 1 });
      }
    }

    return farthest;
  }

  function coordKey(x, y) {
    return `${x},${y}`;
  }

  const NEIGHBORS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  const MIN_DOOR_SPACING = 4;

  function isNavigable(tile) {
    return (
      tile === TILE.FLOOR ||
      tile === TILE.TRAP_HIDDEN ||
      tile === TILE.TRAP_TRIGGERED ||
      tile === TILE.KEY ||
      tile === TILE.STAIRS_DOWN
    );
  }

  function findShortestPath(tiles, start, goal) {
    if (!start || !goal) {
      return null;
    }
    const width = MAP.WIDTH;
    const height = MAP.HEIGHT;
    const visited = new Array(height);
    const prev = new Map();
    for (let y = 0; y < height; y += 1) {
      visited[y] = new Array(width).fill(false);
    }

    const queue = [{ x: start.x, y: start.y }];
    let head = 0;
    visited[start.y][start.x] = true;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;

      if (current.x === goal.x && current.y === goal.y) {
        break;
      }

      for (const dir of NEIGHBORS) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        if (visited[ny][nx]) {
          continue;
        }
        const tile = tiles[ny][nx];
        if (!isNavigable(tile)) {
          continue;
        }
        visited[ny][nx] = true;
        prev.set(coordKey(nx, ny), current);
        queue.push({ x: nx, y: ny });
      }
    }

    if (!visited[goal.y] || !visited[goal.y][goal.x]) {
      return null;
    }

    const path = [];
    let cursor = { x: goal.x, y: goal.y };
    while (cursor) {
      path.push({ x: cursor.x, y: cursor.y });
      if (cursor.x === start.x && cursor.y === start.y) {
        break;
      }
      cursor = prev.get(coordKey(cursor.x, cursor.y));
    }

    return path.reverse();
  }

  function revertModifications(tiles, modifications) {
    if (!Array.isArray(modifications)) {
      return;
    }
    for (const mod of modifications) {
      if (!mod) continue;
      tiles[mod.y][mod.x] = mod.prev;
    }
  }

  function isChokepoint(tiles, x, y) {
    let count = 0;
    for (const dir of NEIGHBORS) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (nx < 0 || nx >= MAP.WIDTH || ny < 0 || ny >= MAP.HEIGHT) {
        continue;
      }
      const tile = tiles[ny][nx];
      if (isNavigable(tile)) {
        count += 1;
      }
    }
    return count <= 2;
  }

  function tryBuildDoorBarrier(tiles, candidate, start, exitPos) {
    const prev = candidate.prev;
    const next = candidate.next;
    if (!prev || !next) {
      return null;
    }
    const isHorizontal = prev.y === candidate.y && next.y === candidate.y;
    const offsets = isHorizontal ? [{ x: 0, y: -1 }, { x: 0, y: 1 }] : [{ x: -1, y: 0 }, { x: 1, y: 0 }];
    const modifications = [];

    const applyOffset = (offset) => {
      let nx = candidate.x + offset.x;
      let ny = candidate.y + offset.y;
      while (nx >= 0 && nx < MAP.WIDTH && ny >= 0 && ny < MAP.HEIGHT) {
        if ((nx === start.x && ny === start.y) || (nx === exitPos.x && ny === exitPos.y)) {
          revertModifications(tiles, modifications);
          console.log("[gen] barrier hit critical tile:", nx, ny);
          return false;
        }
        const tile = tiles[ny][nx];
        if (tile === TILE.WALL) {
          break;
        }
        if (tile === TILE.STAIRS_DOWN || tile === TILE.LOCKED_DOOR) {
          revertModifications(tiles, modifications);
          console.log("[gen] barrier hit restricted tile:", nx, ny, "tile:", tile);
          return false;
        }
        modifications.push({ x: nx, y: ny, prev: tile });
        tiles[ny][nx] = TILE.WALL;
        nx += offset.x;
        ny += offset.y;
      }
      return true;
    };

    for (const offset of offsets) {
      if (!applyOffset(offset)) {
        return null;
      }
    }

    return modifications;
  }

  function isReachable(tiles, start, goal, openDoors, blockedTiles) {
    if (!start || !goal) {
      return false;
    }
    const width = MAP.WIDTH;
    const height = MAP.HEIGHT;
    const visited = new Array(height);
    for (let y = 0; y < height; y += 1) {
      visited[y] = new Array(width).fill(false);
    }
    const queue = [{ x: start.x, y: start.y }];
    let head = 0;
    visited[start.y][start.x] = true;
    const blocked = blockedTiles || new Set();
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      if (current.x === goal.x && current.y === goal.y) {
        return true;
      }
      for (const dir of NEIGHBORS) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        if (visited[ny][nx]) {
          continue;
        }
        const key = coordKey(nx, ny);
        if (blocked.has(key)) {
          continue;
        }
        const tile = tiles[ny][nx];
        if (tile === TILE.LOCKED_DOOR) {
          if (!openDoors || !openDoors.has(key)) {
            continue;
          }
        } else if (!isNavigable(tile)) {
          continue;
        }
        visited[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  function gatherReachableTiles(tiles, start, openDoors, blockedTiles) {
    const reachable = [];
    if (!start) {
      return reachable;
    }
    const width = MAP.WIDTH;
    const height = MAP.HEIGHT;
    const visited = new Array(height);
    for (let y = 0; y < height; y += 1) {
      visited[y] = new Array(width).fill(false);
    }
    const queue = [{ x: start.x, y: start.y }];
    let head = 0;
    visited[start.y][start.x] = true;
    const blocked = blockedTiles || new Set();

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      reachable.push(current);

      for (const dir of NEIGHBORS) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        if (visited[ny][nx]) {
          continue;
        }
        const key = coordKey(nx, ny);
        if (blocked.has(key)) {
          continue;
        }
        const tile = tiles[ny][nx];
        if (tile === TILE.LOCKED_DOOR) {
          if (!openDoors || !openDoors.has(key)) {
            continue;
          }
        } else if (!isNavigable(tile)) {
          continue;
        }
        visited[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }

    return reachable;
  }

  function chooseKeyLocation(rng, tiles, regionStart, openDoors, blockedDoorKey, usedKeys, forbiddenKeys, pathIndexMap, minIndex, maxIndex) {
    const blocked = new Set(blockedDoorKey ? [blockedDoorKey] : []);
    const reachable = gatherReachableTiles(tiles, regionStart, openDoors, blocked);
    if (!reachable.length) {
      console.log("[gen] key search: no reachable tiles (blockedDoor:", blockedDoorKey, ")");
      return null;
    }
    const options = [];
    for (const pos of reachable) {
      const key = coordKey(pos.x, pos.y);
      if (usedKeys.has(key) || forbiddenKeys.has(key)) {
        continue;
      }
      const pathIdx = pathIndexMap ? pathIndexMap.get(key) : undefined;
      if (typeof pathIdx !== "number") {
        continue;
      }
      if (typeof minIndex === "number" && pathIdx <= minIndex) {
        continue;
      }
      if (typeof maxIndex === "number" && pathIdx >= maxIndex) {
        continue;
      }
      const tile = tiles[pos.y][pos.x];
      if (tile !== TILE.FLOOR) {
        continue;
      }
      options.push(pos);
    }
    if (!options.length) {
      console.log("[gen] key search: no floor options (blockedDoor:", blockedDoorKey, ")");
      return null;
    }
    shuffleInPlace(rng, options);
    return options[0];
  }

  function attemptDoorPlacement(rng, tiles, entryStart, exitPos, candidate, openDoors, usedKeys, forbiddenKeys, pathIndexMap, minIndex, maxIndex) {
    const doorKey = coordKey(candidate.x, candidate.y);
    const blocked = new Set([doorKey]);
    const barrierMods = tryBuildDoorBarrier(tiles, candidate, entryStart, exitPos);
    if (!barrierMods) {
      console.log("[gen] barrier construction failed for candidate:", candidate);
      return null;
    }
    console.log("[gen] barrier tiles:", barrierMods.length, "for candidate", candidate);
    if (isReachable(tiles, entryStart, exitPos, openDoors, blocked)) {
      revertModifications(tiles, barrierMods);
      console.log("[gen] door candidate bypassed:", candidate);
      return null;
    }

    const keyPos = chooseKeyLocation(rng, tiles, entryStart, openDoors, doorKey, usedKeys, forbiddenKeys, pathIndexMap, minIndex, maxIndex);
    if (!keyPos) {
      revertModifications(tiles, barrierMods);
      console.log("[gen] door candidate no key available:", candidate);
      return null;
    }

    tiles[candidate.y][candidate.x] = TILE.LOCKED_DOOR;
    tiles[keyPos.y][keyPos.x] = TILE.KEY;
    openDoors.add(doorKey);
    usedKeys.add(coordKey(keyPos.x, keyPos.y));
    console.log("[gen] placed door:", candidate, "with key:", keyPos);
    return { door: { x: candidate.x, y: candidate.y }, key: keyPos };
  }

  function forceDoorPlacement(rng, tiles, path, entryStart, lastDoorIndex, exitPos, openDoors, usedKeys, forbiddenKeys, pathIndexMap) {
    for (let i = 1; i < path.length - 1; i += 1) {
      const current = path[i];
      if (tiles[current.y][current.x] !== TILE.FLOOR) {
        continue;
      }
      const prev = path[i - 1];
      const next = path[i + 1];
      const candidate = { x: current.x, y: current.y, prev, next, index: i };
      if (candidate.index - lastDoorIndex < MIN_DOOR_SPACING) {
        continue;
      }
      if (candidate.index <= 2 || candidate.index >= path.length - 3) {
        continue;
      }
      const approach = prev ? { x: prev.x, y: prev.y } : entryStart;
      const modifications = tryBuildDoorBarrier(tiles, candidate, approach, exitPos);
      if (!modifications) {
        continue;
      }
      const doorKey = coordKey(current.x, current.y);
      const reachBlocked = new Set([doorKey]);
      if (isReachable(tiles, approach, exitPos, openDoors, reachBlocked)) {
        revertModifications(tiles, modifications);
        console.log("[gen] forced candidate still reachable:", current);
        continue;
      }

      const minIndex = Number.isFinite(lastDoorIndex) ? lastDoorIndex + 1 : 0;
      const maxIndex = i - 1;
      const keyPos = chooseKeyLocation(rng, tiles, approach, openDoors, doorKey, usedKeys, forbiddenKeys, pathIndexMap, minIndex, maxIndex);
      if (!keyPos) {
        revertModifications(tiles, modifications);
        console.log("[gen] forced door key placement failed at", current);
        continue;
      }

      tiles[current.y][current.x] = TILE.LOCKED_DOOR;
      tiles[keyPos.y][keyPos.x] = TILE.KEY;
      openDoors.add(doorKey);
      usedKeys.add(coordKey(keyPos.x, keyPos.y));
      console.log("[gen] forced door:", current, "with key:", keyPos, "barrier tiles:", modifications.length);
      const nextEntry = next ? { x: next.x, y: next.y } : { x: current.x, y: current.y };
      return { door: { x: current.x, y: current.y }, key: keyPos, index: i, nextEntry };
    }
    return null;
  }

  function placeDoorsAndKeys(rng, tiles, start, exitPos) {
    if (!start || !exitPos) {
      return;
    }
    const path = findShortestPath(tiles, start, exitPos);
    if (!path || path.length < 3) {
      return;
    }

    const pathIndexMap = new Map();
    for (let i = 0; i < path.length; i += 1) {
      const node = path[i];
      pathIndexMap.set(coordKey(node.x, node.y), i);
    }

    const candidates = [];
    for (let i = 1; i < path.length - 1; i += 1) {
      const step = path[i];
      if (tiles[step.y][step.x] !== TILE.FLOOR) {
        continue;
      }
      candidates.push({ x: step.x, y: step.y, index: i, prev: path[i - 1], next: path[i + 1] });
    }

    const openDoors = new Set();
    const usedKeys = new Set();
    const forbiddenKeys = new Set([coordKey(start.x, start.y), coordKey(exitPos.x, exitPos.y)]);
    const placed = [];
    let lastDoorIndex = -Infinity;
    let entryStart = { x: start.x, y: start.y };

    console.log("[gen] path length:", path.length, "candidates:", candidates.length);

    if (!candidates.length) {
      const forced = forceDoorPlacement(rng, tiles, path, entryStart, lastDoorIndex, exitPos, openDoors, usedKeys, forbiddenKeys, pathIndexMap);
      if (forced) {
        placed.push(forced);
        lastDoorIndex = forced.index;
        forbiddenKeys.add(coordKey(forced.key.x, forced.key.y));
        entryStart = forced.nextEntry || entryStart;
      }
      console.log("[gen] no candidates; forced door result:", !!placed.length);
      return;
    }

    shuffleInPlace(rng, candidates);
    candidates.sort((a, b) => a.index - b.index);

    const desiredDoors = Math.max(1, Math.min(3, Math.floor(path.length / 12) + 1, candidates.length));
    for (const candidate of candidates) {
      if (placed.length >= desiredDoors) {
        break;
      }
      if (candidate.index - lastDoorIndex < MIN_DOOR_SPACING) {
        console.log("[gen] candidate too close to previous door:", candidate);
        continue;
      }
      if (candidate.index <= 2 || candidate.index >= path.length - 3) {
        console.log("[gen] candidate too close to spawn/exit:", candidate);
        continue;
      }
      if (!isChokepoint(tiles, candidate.x, candidate.y)) {
        console.log("[gen] candidate not chokepoint:", candidate);
        continue;
      }
      const approach = candidate.prev ? { x: candidate.prev.x, y: candidate.prev.y } : entryStart;
      const minIndex = Number.isFinite(lastDoorIndex) ? lastDoorIndex + 1 : 0;
      const maxIndex = candidate.index - 1;
      const result = attemptDoorPlacement(rng, tiles, approach, exitPos, candidate, openDoors, usedKeys, forbiddenKeys, pathIndexMap, minIndex, maxIndex);
      if (result) {
        placed.push(result);
        lastDoorIndex = candidate.index;
        forbiddenKeys.add(coordKey(result.key.x, result.key.y));
        if (candidate.next) {
          entryStart = { x: candidate.next.x, y: candidate.next.y };
        }
      }
    }

    if (!placed.length) {
      const forced = forceDoorPlacement(rng, tiles, path, entryStart, lastDoorIndex, exitPos, openDoors, usedKeys, forbiddenKeys, pathIndexMap);
      if (!forced) {
        console.log("[gen] forced placement failed");
        return;
      }
      placed.push(forced);
      lastDoorIndex = forced.index;
      forbiddenKeys.add(coordKey(forced.key.x, forced.key.y));
      entryStart = forced.nextEntry || entryStart;
    }

    console.log("[gen] total doors placed:", placed.length);
  }

  function createMonsters(rng, depth, tiles, playerPos, exitPos) {
    const monsters = [];
    const count = Math.min(12 + Math.floor(depth / 2), 35);
    let attempts = 0;
    while (monsters.length < count && attempts < 200) {
      attempts += 1;
      const spot = findFloorTile(rng, tiles);
      const distance = Math.abs(spot.x - playerPos.x) + Math.abs(spot.y - playerPos.y);
      if (distance < 5) {
        continue;
      }
      if (exitPos && spot.x === exitPos.x && spot.y === exitPos.y) {
        continue;
      }
      const occupied = monsters.some((m) => m.x === spot.x && m.y === spot.y);
      if (occupied) {
        continue;
      }
      const stats = calcMonsterStats(depth + attempts * 0.01);
      monsters.push({
        id: monsterIdCounter += 1,
        x: spot.x,
        y: spot.y,
        hp: stats.hp,
        hpMax: stats.hp,
        dmg: stats.dmg,
        xp: stats.xp,
        alerted: false
      });
    }
    return monsters;
  }

  function Game() {
    this.state = null;
    this.rng = mulberry32(Date.now());
    this.bestScore = Number(window.localStorage.getItem(LOCAL_STORAGE_KEY) || 0);
    this.resetRun();
  }

  Game.prototype.resetRun = function () {
    this.state = {
      depth: 1,
      tiles: makeEmptyMap(),
      player: createPlayer(),
      monsters: [],
      running: true,
      events: [],
      lastAction: null
    };
    this.state.player.keys = 0;
    this.regenerateFloor();
  };

  Game.prototype.regenerateFloor = function () {
    const { depth } = this.state;
    const tiles = makeEmptyMap();
    const seed = Date.now() + depth * 1337;
    this.rng = mulberry32(seed);
    let rooms = placeRooms(this.rng, tiles, depth);
    if (!rooms.length) {
      rooms = [makeRoom(1, 1, 8, 8)];
      for (let yy = 1; yy < 9; yy += 1) {
        for (let xx = 1; xx < 9; xx += 1) {
          tiles[yy][xx] = TILE.FLOOR;
        }
      }
    }

    connectRooms(this.rng, tiles, rooms);

    const mapCenterX = Math.floor(MAP.WIDTH / 2);
    const mapCenterY = Math.floor(MAP.HEIGHT / 2);
    const centerRef = { cx: mapCenterX, cy: mapCenterY };
    const spawnRoom = rooms.reduce((best, room) => {
      const bestDist = roomDistanceSq(best, centerRef);
      const roomDist = roomDistanceSq(room, centerRef);
      return roomDist < bestDist ? room : best;
    }, rooms[0]);

    const px = spawnRoom ? spawnRoom.cx : Math.floor(MAP.WIDTH / 2);
    const py = spawnRoom ? spawnRoom.cy : Math.floor(MAP.HEIGHT / 2);
    this.state.player.x = px;
    this.state.player.y = py;

    sprinkleFeatures(this.rng, tiles, depth, rooms, { x: px, y: py });

    const farthest = findFarthestFloor(tiles, px, py);
    if (farthest.x !== px || farthest.y !== py) {
      tiles[farthest.y][farthest.x] = TILE.STAIRS_DOWN;
    }

    placeDoorsAndKeys(this.rng, tiles, { x: px, y: py }, farthest);

    this.state.tiles = tiles;
    this.state.monsters = createMonsters(this.rng, depth, tiles, { x: px, y: py }, farthest);

    this.state.events = [];
    this.state.lastAction = null;
  };

  Game.prototype.getSnapshot = function () {
    return JSON.parse(JSON.stringify({
      depth: this.state.depth,
      tiles: this.state.tiles,
      player: this.state.player,
      monsters: this.state.monsters,
      running: this.state.running,
      lastAction: this.state.lastAction,
      bestScore: this.bestScore
    }));
  };

  Game.prototype.handleMove = function (dir) {
    if (!this.state.running) {
      return;
    }
    const player = this.state.player;
    const nx = player.x + dir.x;
    const ny = player.y + dir.y;
    if (!this.withinBounds(nx, ny)) {
      return;
    }

    const tile = this.state.tiles[ny][nx];
    const events = [];
    let moved = false;
    if (tile === TILE.WALL) {
      return;
    }

    if (tile === TILE.LOCKED_DOOR) {
      if (player.keys > 0) {
        player.keys -= 1;
        this.state.tiles[ny][nx] = TILE.FLOOR;
        events.push({ type: "door-unlocked", x: nx, y: ny });
      } else {
        events.push({ type: "door-locked" });
        this.state.events = events;
        this.state.lastAction = events[events.length - 1];
        return;
      }
    }

    player.x = nx;
    player.y = ny;
    moved = true;

    if (tile === TILE.KEY) {
      player.keys += 1;
      this.state.tiles[ny][nx] = TILE.FLOOR;
      events.push({ type: "key-found", x: nx, y: ny, total: player.keys });
    } else if (tile === TILE.TRAP_HIDDEN) {
      const damage = Math.max(4, Math.floor(player.hpMax * 0.15));
      player.hp = Math.max(0, player.hp - damage);
      this.state.tiles[ny][nx] = TILE.TRAP_TRIGGERED;
      events.push({ type: "trap", amount: damage, x: nx, y: ny });
      if (player.hp <= 0) {
        this.endRun();
      }
    }

    const monster = this.findMonsterAt(nx, ny);
    if (monster) {
      this.resolveCombat(monster, events);
    }

    if (tile === TILE.STAIRS_DOWN && this.state.running) {
      this.advanceFloor();
      events.push({ type: "depth", depth: this.state.depth });
      this.state.events = events;
      this.state.lastAction = events.length ? events[events.length - 1] : null;
      return;
    }

    if (moved && this.state.running) {
      this.monsterTurn(events);
    }

    this.state.events = events;
    this.state.lastAction = events.length ? events[events.length - 1] : null;
  };

  Game.prototype.findMonsterAt = function (x, y) {
    return this.state.monsters.find((m) => m.x === x && m.y === y);
  };

  Game.prototype.resolveCombat = function (monster, events) {
    const player = this.state.player;
    const playerDmg = Math.max(3, Math.floor(player.lvl * 2 + this.state.depth * 0.3));
    monster.hp -= playerDmg;
    monster.alerted = true;
    const monsterDmg = monster.hp > 0 ? monster.dmg : Math.floor(monster.dmg * 0.5);
    player.hp = Math.max(0, player.hp - monsterDmg);

    events.push({
      type: "combat",
      monsterId: monster.id,
      playerDmg,
      monsterDmg,
      monsterHp: monster.hp
    });

    if (monster.hp <= 0) {
      this.state.monsters = this.state.monsters.filter((m) => m.id !== monster.id);
      events.push({ type: "monster-defeated", monsterId: monster.id });
      this.grantXP(monster.xp, events);
    }

    if (player.hp <= 0) {
      this.endRun();
      events.push({ type: "player-defeated" });
    }
  };

  Game.prototype.grantXP = function (amount, events) {
    const player = this.state.player;
    player.xp += amount;
    events.push({ type: "xp", amount });

    while (player.xp >= player.xpMax) {
      player.xp -= player.xpMax;
      player.lvl += 1;
      player.hpMax = Math.round(player.hpMax * 1.12 + 6);
      player.hp = player.hpMax;
      player.xpMax = Math.round(player.xpMax * 1.25 + 10);
      events.push({ type: "level-up", lvl: player.lvl, fullHeal: true });
    }
  };

  Game.prototype.advanceFloor = function () {
    if (this.state.depth >= MAX_DEPTH) {
      this.endRun();
      return;
    }
    this.state.depth += 1;
    if (this.state.depth > this.bestScore) {
      this.bestScore = this.state.depth;
      window.localStorage.setItem(LOCAL_STORAGE_KEY, String(this.bestScore));
    }
    this.regenerateFloor();
  };

  Game.prototype.endRun = function () {
    this.state.running = false;
  };

  Game.prototype.withinBounds = function (x, y) {
    return x >= 0 && x < MAP.WIDTH && y >= 0 && y < MAP.HEIGHT;
  };

  Game.prototype.restart = function () {
    this.resetRun();
  };

  Game.prototype.monsterTurn = function (events) {
    if (!this.state.running) {
      return;
    }

    const player = this.state.player;
    const tiles = this.state.tiles;
    const monsters = this.state.monsters.slice();

    for (const monster of monsters) {
      if (!monster.alerted) {
        const seesPlayer = hasLineOfSight(monster.x, monster.y, player.x, player.y, tiles, MONSTER_VIEW_RANGE);
        if (!seesPlayer) {
          continue;
        }
        monster.alerted = true;
      }

      if (!this.state.running) {
        break;
      }

      const dx = player.x - monster.x;
      const dy = player.y - monster.y;

      if (dx === 0 && dy === 0) {
        this.resolveCombat(monster, events);
        if (!this.state.running) {
          break;
        }
        continue;
      }

      const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
      const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
      const preferHorizontal = Math.abs(dx) >= Math.abs(dy);
      const tryDirections = [];

      if (preferHorizontal && stepX !== 0) {
        tryDirections.push({ x: stepX, y: 0 });
      }
      if (stepY !== 0) {
        tryDirections.push({ x: 0, y: stepY });
      }
      if (!preferHorizontal && stepX !== 0) {
        tryDirections.push({ x: stepX, y: 0 });
      }

      for (const dir of tryDirections) {
        const nx = monster.x + dir.x;
        const ny = monster.y + dir.y;
        if (!this.withinBounds(nx, ny)) {
          continue;
        }
        if (!isWalkable(tiles[ny][nx])) {
          continue;
        }
        const occupied = this.state.monsters.some((other) => other.id !== monster.id && other.x === nx && other.y === ny);
        if (occupied) {
          continue;
        }
        monster.x = nx;
        monster.y = ny;
        break;
      }

      if (monster.x === player.x && monster.y === player.y && this.state.running) {
        this.resolveCombat(monster, events);
        if (!this.state.running) {
          break;
        }
      }
    }
  };

  Game.prototype.update = function () {
    // Turn-based: per-frame updates not required at the moment.
  };

  Game.prototype.consumeEvents = function () {
    const current = Array.isArray(this.state.events) ? this.state.events : [];
    this.state.events = [];
    return current.slice();
  };

  Game.prototype.collectTelemetry = function () {
    return {
      depth: this.state.depth,
      hp: `${this.state.player.hp} / ${this.state.player.hpMax}`,
      xp: `${this.state.player.xp} / ${this.state.player.xpMax}`,
      lvl: this.state.player.lvl,
      keys: this.state.player.keys,
      monsters: this.state.monsters.length,
      running: this.state.running
    };
  };

  window.GameLogic = {
    createGame() {
      return new Game();
    },
    TILE,
    DIRS,
    MAP,
    MAX_DEPTH
  };
})();
