(function () {
  const TILE = {
    VOID: 0,
    FLOOR: 1,
    WALL: 2,
    LOCKED_DOOR: 3,
    SECRET_DOOR: 4,
    TRAP_HIDDEN: 5,
    TRAP_TRIGGERED: 6,
    STAIRS_DOWN: 7
  };

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  const MAP = {
    WIDTH: 21,
    HEIGHT: 21
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

  function placeRooms(rng, tiles) {
    const roomCount = 6;
    const rooms = [];
    for (let i = 0; i < roomCount; i += 1) {
      const w = randomInt(rng, 4, 6);
      const h = randomInt(rng, 4, 6);
      const x = randomInt(rng, 1, MAP.WIDTH - w - 2);
      const y = randomInt(rng, 1, MAP.HEIGHT - h - 2);
      rooms.push({ x, y, w, h });
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
          tiles[yy][xx] = TILE.FLOOR;
        }
      }
    }
    return rooms;
  }

  function connectRooms(rng, tiles, rooms) {
    rooms.sort((a, b) => a.x - b.x);
    for (let i = 0; i < rooms.length - 1; i += 1) {
      const a = rooms[i];
      const b = rooms[i + 1];
      const x1 = randomInt(rng, a.x, a.x + a.w - 1);
      const y1 = randomInt(rng, a.y, a.y + a.h - 1);
      const x2 = randomInt(rng, b.x, b.x + b.w - 1);
      const y2 = randomInt(rng, b.y, b.y + b.h - 1);

      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      for (let x = minX; x <= maxX; x += 1) {
        tiles[y1][x] = TILE.FLOOR;
      }
      for (let y = minY; y <= maxY; y += 1) {
        tiles[y][x2] = TILE.FLOOR;
      }
    }
  }

  function sprinkleFeatures(rng, tiles, depth) {
    const candidates = [];
    for (let y = 1; y < MAP.HEIGHT - 1; y += 1) {
      for (let x = 1; x < MAP.WIDTH - 1; x += 1) {
        if (tiles[y][x] === TILE.FLOOR) {
          candidates.push({ x, y });
        }
      }
    }

    const trapCount = Math.min(6, 2 + Math.floor(depth / 5));
    const secretCount = 2;
    const lockedCount = 1 + Math.floor(depth / 20);

    shuffleInPlace(rng, candidates);

    for (let i = 0; i < trapCount && candidates.length; i += 1) {
      const tile = candidates.pop();
      tiles[tile.y][tile.x] = TILE.TRAP_HIDDEN;
    }

    for (let i = 0; i < secretCount && candidates.length; i += 1) {
      const tile = candidates.pop();
      tiles[tile.y][tile.x] = TILE.SECRET_DOOR;
    }

    for (let i = 0; i < lockedCount && candidates.length; i += 1) {
      const tile = candidates.pop();
      tiles[tile.y][tile.x] = TILE.LOCKED_DOOR;
    }
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

  function createMonsters(rng, depth, tiles, playerPos) {
    const monsters = [];
    const count = Math.min(8 + Math.floor(depth / 3), 20);
    let attempts = 0;
    while (monsters.length < count && attempts < 200) {
      attempts += 1;
      const spot = findFloorTile(rng, tiles);
      const distance = Math.abs(spot.x - playerPos.x) + Math.abs(spot.y - playerPos.y);
      if (distance < 4) {
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
    const rooms = placeRooms(this.rng, tiles);
    connectRooms(this.rng, tiles, rooms);
    sprinkleFeatures(this.rng, tiles, depth);
    const playerSpawn = rooms.length ? rooms[0] : { x: 1, y: 1, w: 1, h: 1 };
    const px = Math.floor(playerSpawn.x + playerSpawn.w / 2);
    const py = Math.floor(playerSpawn.y + playerSpawn.h / 2);
    this.state.player.x = px;
    this.state.player.y = py;

    const stairs = findFloorTile(this.rng, tiles);
    tiles[stairs.y][stairs.x] = TILE.STAIRS_DOWN;

    this.state.tiles = tiles;
    this.state.monsters = createMonsters(this.rng, depth, tiles, { x: px, y: py });
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

    if (tile === TILE.TRAP_HIDDEN) {
      const damage = Math.max(4, Math.floor(player.hpMax * 0.15));
      player.hp = Math.max(0, player.hp - damage);
      this.state.tiles[ny][nx] = TILE.TRAP_TRIGGERED;
      events.push({ type: "trap", amount: damage });
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
