/*!
 * 霓虹贪吃蛇 · pure game logic
 * Works both as a classic browser script (window.SnakeGame) and as a CommonJS module.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SnakeGame = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    cols: 20,
    rows: 20,
    baseTickMs: 150,
    minTickMs: 70,
    tickStepMs: 12,
    levelEvery: 5,
    scorePerApple: 10,
  });

  const DIRECTIONS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1 }),
    down: Object.freeze({ x: 0, y: 1 }),
    left: Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 }),
  });

  function samePoint(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function contains(points, target) {
    for (let i = 0; i < points.length; i += 1) {
      if (samePoint(points[i], target)) return true;
    }
    return false;
  }

  function cloneDirection(direction) {
    return { x: direction.x, y: direction.y };
  }

  function configFor(state) {
    return Object.assign({}, DEFAULTS, state.config || {});
  }

  function level(state) {
    const config = configFor(state);
    return 1 + Math.floor(state.apples / config.levelEvery);
  }

  function tickMs(state) {
    const config = configFor(state);
    return Math.max(config.minTickMs, config.baseTickMs - (level(state) - 1) * config.tickStepMs);
  }

  function spawnFood(state) {
    const free = [];
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (!contains(state.snake, { x, y })) free.push({ x, y });
      }
    }
    if (free.length === 0) return null;
    const index = Math.min(free.length - 1, Math.max(0, Math.floor(state.rng() * free.length)));
    return free[index];
  }

  function createGame(options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const cols = Math.max(1, Math.floor(opts.cols));
    const rows = Math.max(1, Math.floor(opts.rows));
    const headX = Math.min(cols - 1, Math.max(2, Math.floor(cols / 2)));
    const headY = Math.min(rows - 1, Math.max(0, Math.floor(rows / 2)));
    const snake = [];
    for (let i = 0; i < Math.min(3, cols); i += 1) {
      snake.push({ x: headX - i, y: headY });
    }

    const state = {
      cols,
      rows,
      snake,
      direction: cloneDirection(DIRECTIONS.right),
      queue: [],
      food: null,
      score: 0,
      apples: 0,
      status: 'ready',
      overReason: null,
      rng: typeof opts.rng === 'function' ? opts.rng : Math.random,
      config: {
        baseTickMs: opts.baseTickMs,
        minTickMs: opts.minTickMs,
        tickStepMs: opts.tickStepMs,
        levelEvery: opts.levelEvery,
        scorePerApple: opts.scorePerApple,
      },
    };

    state.food = spawnFood(state);
    if (!state.food) state.status = 'won';
    return state;
  }

  function start(state) {
    if (state.status !== 'ready') return false;
    state.status = 'running';
    return true;
  }

  function setDirection(state, direction) {
    if (state.status !== 'running') return false;
    const next = typeof direction === 'string' ? DIRECTIONS[direction] : direction;
    if (!next) return false;
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return false;
    if (Math.abs(next.x) + Math.abs(next.y) !== 1) return false;
    if (state.queue.length >= 2) return false;

    const reference = state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.direction;
    const same = next.x === reference.x && next.y === reference.y;
    const opposite = next.x === -reference.x && next.y === -reference.y;
    if (same || opposite) return false;

    state.queue.push({ x: next.x, y: next.y });
    return true;
  }

  function togglePause(state) {
    if (state.status === 'running') {
      state.status = 'paused';
      return 'paused';
    }
    if (state.status === 'paused') {
      state.status = 'running';
      return 'running';
    }
    return state.status;
  }

  function step(state) {
    const idle = { moved: false, eaten: false, over: false, won: false };
    if (state.status !== 'running') return idle;

    if (state.queue.length > 0) {
      state.direction = state.queue.shift();
    }

    const head = state.snake[0];
    const next = { x: head.x + state.direction.x, y: head.y + state.direction.y };

    if (next.x < 0 || next.x >= state.cols || next.y < 0 || next.y >= state.rows) {
      state.status = 'over';
      state.overReason = 'wall';
      return { moved: false, eaten: false, over: true, won: false };
    }

    const eating = Boolean(state.food) && samePoint(next, state.food);
    const body = eating ? state.snake : state.snake.slice(0, -1);
    if (contains(body, next)) {
      state.status = 'over';
      state.overReason = 'self';
      return { moved: false, eaten: false, over: true, won: false };
    }

    state.snake.unshift(next);
    if (!eating) {
      state.snake.pop();
      return { moved: true, eaten: false, over: false, won: false };
    }

    const config = configFor(state);
    state.score += config.scorePerApple;
    state.apples += 1;
    state.food = spawnFood(state);
    if (!state.food) {
      state.status = 'won';
      return { moved: true, eaten: true, over: false, won: true };
    }
    return { moved: true, eaten: true, over: false, won: false };
  }

  return Object.freeze({
    DEFAULTS,
    DIRECTIONS,
    createGame,
    start,
    setDirection,
    togglePause,
    step,
    level,
    tickMs,
  });
});
