import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Snake = require('../game.js');

function runningGame(overrides = {}) {
  const game = Snake.createGame(Object.assign({ cols: 8, rows: 8, rng: () => 0 }, overrides));
  Snake.start(game);
  return game;
}

function findHead(game) {
  return game.snake[0];
}

test('createGame starts a ready 20x20 board with a food away from the snake', () => {
  const game = Snake.createGame({ rng: () => 0.5 });
  assert.equal(game.status, 'ready');
  assert.equal(game.cols, 20);
  assert.equal(game.rows, 20);
  assert.equal(game.snake.length, 3);
  assert.deepEqual(game.snake, [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ]);
  assert.deepEqual(game.direction, { x: 1, y: 0 });
  assert.deepEqual(game.queue, []);
  assert.equal(game.score, 0);
  assert.equal(game.apples, 0);
  assert.ok(game.food, 'food should exist on a 20x20 board');
  assert.ok(!game.snake.some((segment) => segment.x === game.food.x && segment.y === game.food.y));
});

test('start only transitions a ready game into running', () => {
  const game = Snake.createGame();
  assert.equal(Snake.start(game), true);
  assert.equal(game.status, 'running');
  assert.equal(Snake.start(game), false);
  assert.equal(game.status, 'running');
});

test('step moves one cell, removes the tail and keeps length', () => {
  const game = runningGame({ cols: 8, rows: 8 });
  const before = game.snake.length;
  const result = Snake.step(game);
  assert.equal(result.moved, true);
  assert.equal(result.eaten, false);
  assert.equal(result.over, false);
  assert.deepEqual(findHead(game), { x: 5, y: 4 });
  assert.equal(game.snake.length, before);
  assert.equal(game.score, 0);
});

test('eating grows the snake, adds score and places food off the snake', () => {
  const game = runningGame({ cols: 8, rows: 8, rng: () => 0 });
  game.food = { x: game.snake[0].x + 1, y: game.snake[0].y };
  const before = game.snake.length;
  const result = Snake.step(game);
  assert.equal(result.eaten, true);
  assert.equal(result.over, false);
  assert.equal(game.snake.length, before + 1);
  assert.equal(game.score, 10);
  assert.equal(game.apples, 1);
  assert.ok(game.food, 'a new food should be spawned');
  assert.ok(!game.snake.some((segment) => segment.x === game.food.x && segment.y === game.food.y));
});

test('hitting a wall ends the game with a wall reason', () => {
  const game = runningGame({ cols: 5, rows: 5 });
  let last = null;
  for (let i = 0; i < 10 && game.status === 'running'; i += 1) {
    last = Snake.step(game);
  }
  assert.equal(game.status, 'over');
  assert.equal(game.overReason, 'wall');
  assert.equal(last.over, true);
  assert.equal(last.moved, false);
});

test('hitting the body ends the game with a self reason', () => {
  const game = runningGame({ cols: 8, rows: 8 });
  game.snake = [
    { x: 2, y: 2 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 1, y: 3 },
  ];
  game.direction = { x: -1, y: 0 };
  game.food = { x: 7, y: 7 };
  const result = Snake.step(game);
  assert.equal(result.over, true);
  assert.equal(result.eaten, false);
  assert.equal(game.status, 'over');
  assert.equal(game.overReason, 'self');
});

test('moving into the tail cell that is about to vacate is allowed', () => {
  const game = runningGame({ cols: 8, rows: 8 });
  game.snake = [
    { x: 2, y: 2 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
  ];
  game.direction = { x: -1, y: 0 };
  game.food = { x: 7, y: 7 };
  const result = Snake.step(game);
  assert.equal(result.over, false);
  assert.equal(result.moved, true);
  assert.deepEqual(findHead(game), { x: 1, y: 2 });
  assert.equal(game.snake.length, 4);
});

test('direction input rejects reversals, caps the queue and is applied in order', () => {
  const game = runningGame({ cols: 8, rows: 8 });
  assert.equal(Snake.setDirection(game, 'left'), false, 'reversal must be rejected');
  assert.equal(Snake.setDirection(game, 'up'), true);
  assert.equal(Snake.setDirection(game, 'down'), false, 'reversal of the queued turn must be rejected');
  assert.equal(Snake.setDirection(game, 'left'), true);
  assert.equal(Snake.setDirection(game, 'down'), false, 'queue is capped at two turns');
  assert.deepEqual(game.queue, [
    { x: 0, y: -1 },
    { x: -1, y: 0 },
  ]);

  Snake.step(game);
  assert.deepEqual(game.direction, { x: 0, y: -1 });
  assert.deepEqual(findHead(game), { x: 4, y: 3 });
  Snake.step(game);
  assert.deepEqual(game.direction, { x: -1, y: 0 });
  assert.deepEqual(findHead(game), { x: 3, y: 3 });
});

test('pause stops movement until the game is resumed', () => {
  const game = runningGame({ cols: 8, rows: 8 });
  const head = Object.assign({}, findHead(game));
  assert.equal(Snake.togglePause(game), 'paused');
  assert.equal(game.status, 'paused');
  assert.deepEqual(Snake.step(game), { moved: false, eaten: false, over: false, won: false });
  assert.deepEqual(findHead(game), head);
  assert.equal(Snake.togglePause(game), 'running');
  assert.equal(Snake.step(game).moved, true);
});

test('speed levels up with apples, never below the floor and never above the base', () => {
  const game = Snake.createGame({ rng: () => 0 });
  assert.equal(Snake.level(game), 1);
  assert.equal(Snake.tickMs(game), 150);
  game.apples = 4;
  assert.equal(Snake.level(game), 1);
  assert.equal(Snake.tickMs(game), 150);
  game.apples = 5;
  assert.equal(Snake.level(game), 2);
  assert.equal(Snake.tickMs(game), 138);
  game.apples = 10;
  assert.equal(Snake.level(game), 3);
  game.apples = 1000;
  assert.equal(Snake.tickMs(game), 70);
});

test('filling the board after eating the last cell wins the game', () => {
  const game = runningGame({ cols: 3, rows: 3 });
  game.snake = [
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
  ];
  game.direction = { x: 1, y: 0 };
  game.food = { x: 2, y: 1 };
  const result = Snake.step(game);
  assert.equal(result.eaten, true);
  assert.equal(result.won, true);
  assert.equal(game.status, 'won');
  assert.equal(game.food, null);
  assert.equal(game.score, 10);
});

test('a finished game ignores further steps', () => {
  const game = runningGame({ cols: 5, rows: 5 });
  while (game.status === 'running') Snake.step(game);
  const head = Object.assign({}, findHead(game));
  const result = Snake.step(game);
  assert.equal(result.moved, false);
  assert.deepEqual(findHead(game), head);
});

test('tiny boards still produce a valid, in-bounds snake and food', () => {
  for (let size = 1; size <= 4; size += 1) {
    const game = Snake.createGame({ cols: size, rows: size });
    assert.equal(game.snake.length, Math.min(3, size));
    for (const segment of game.snake) {
      assert.ok(segment.x >= 0 && segment.x < size, `segment x on ${size}x${size}`);
      assert.ok(segment.y >= 0 && segment.y < size, `segment y on ${size}x${size}`);
    }
    if (game.food) {
      assert.ok(game.food.x >= 0 && game.food.x < size);
      assert.ok(game.food.y >= 0 && game.food.y < size);
    }
  }
});
