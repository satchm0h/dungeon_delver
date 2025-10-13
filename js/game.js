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
    return tile === TILE.WALL || tile === TILE.LOCKED_DOOR || tile === TILE.SECRET_DOOR;
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
    const secretCount = Math.min(5, 2 + Math.floor(depth / 8));
    const lockedCount = Math.min(4, 1 + Math.floor(depth / 18));
    const keyCount = Math.max(lockedCount + 1, Math.min(6, 2 + Math.floor(depth / 5)));

    shuffleInPlace(rng, candidates);
    const keyCandidates = candidates.slice();
    shuffleInPlace(rng, keyCandidates);

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

    placeFeature(keyCandidates, keyCount, (tile) => {
      tiles[tile.y][tile.x] = TILE.KEY;
    });

    placeFeature(candidates, trapCount, (tile) => {
      tiles[tile.y][tile.x] = TILE.TRAP_HIDDEN;
    });

    placeFeature(candidates, secretCount, (tile) => {
      tiles[tile.y][tile.x] = TILE.SECRET_DOOR;
    });

    placeFeature(candidates, lockedCount, (tile) => {
      tiles[tile.y][tile.x] = TILE.LOCKED_DOOR;
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

    if (tile === TILE.SECRET_DOOR) {
      this.state.tiles[ny][nx] = TILE.FLOOR;
      events.push({ type: "secret-revealed", x: nx, y: ny });
      this.state.events = events;
      this.state.lastAction = events[events.length - 1];
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
      if (this.rng() < 0.15) {
        this.state.player.keys += 1;
        events.push({ type: "key-drop" });
      }
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
    this.state.player.keys += 1;
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
