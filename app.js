/*!
 * 霓虹贪吃蛇 · UI, canvas renderer and input
 * Classic script; expects window.SnakeGame from game.js.
 */
(function () {
  'use strict';

  const Snake = window.SnakeGame;
  if (!Snake) throw new Error('SnakeGame did not load');

  const STORAGE_BEST = 'neon-snake.best';
  const STORAGE_MUTED = 'neon-snake.muted';
  const MAX_PARTICLES = 90;
  const reduceMotion = Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const els = {
    canvas: document.getElementById('board'),
    wrap: document.getElementById('board-wrap'),
    overlay: document.getElementById('overlay'),
    overlayEyebrow: document.getElementById('overlay-eyebrow'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayDesc: document.getElementById('overlay-desc'),
    overlayScore: document.getElementById('overlay-score'),
    action: document.getElementById('action'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    level: document.getElementById('level'),
    pause: document.getElementById('pause'),
    pauseIcon: document.getElementById('pause-icon'),
    playIcon: document.getElementById('play-icon'),
    sound: document.getElementById('sound'),
    soundOnIcon: document.getElementById('sound-on-icon'),
    soundOffIcon: document.getElementById('sound-off-icon'),
    dpad: document.getElementById('dpad'),
  };

  const ctx = els.canvas.getContext('2d');

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (error) {
      /* storage can be unavailable (private mode, file://); keep playing */
    }
  }

  let best = Number.parseInt(readStorage(STORAGE_BEST) || '0', 10);
  if (!Number.isFinite(best) || best < 0) best = 0;

  const Sound = (function createSound() {
    let audio = null;
    let muted = readStorage(STORAGE_MUTED) === '1';

    function ensureAudio() {
      if (muted) return null;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      if (!audio) {
        try {
          audio = new AudioCtor();
        } catch (error) {
          return null;
        }
      }
      if (audio.state === 'suspended') {
        audio.resume().catch(function ignore() {});
      }
      return audio;
    }

    function play(freqs, options) {
      const audioCtx = ensureAudio();
      if (!audioCtx) return;
      const opts = options || {};
      const wave = opts.type || 'sine';
      const volume = opts.gain || 0.04;
      const duration = opts.duration || 0.1;
      const spacing = opts.spacing || 0.06;
      const sweep = opts.sweep || 0;
      const now = audioCtx.currentTime;

      freqs.forEach(function eachFrequency(freq, index) {
        const oscillator = audioCtx.createOscillator();
        const envelope = audioCtx.createGain();
        const start = now + index * spacing;
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(freq, start);
        if (sweep) {
          oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(30, freq + sweep),
            start + duration
          );
        }
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(envelope);
        envelope.connect(audioCtx.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.03);
      });
    }

    return Object.freeze({
      eat: function eat() {
        play([660, 990], { type: 'triangle', gain: 0.045, duration: 0.09, spacing: 0.05 });
      },
      start: function startSound() {
        play([392, 523, 784], { type: 'sine', gain: 0.035, duration: 0.11, spacing: 0.07 });
      },
      die: function die() {
        play([196, 147, 98], { type: 'sawtooth', gain: 0.03, duration: 0.2, spacing: 0.09, sweep: -30 });
      },
      win: function win() {
        play([523, 659, 784, 1047], { type: 'triangle', gain: 0.035, duration: 0.14, spacing: 0.09 });
      },
      toggle: function toggle() {
        muted = !muted;
        writeStorage(STORAGE_MUTED, muted ? '1' : '0');
        if (!muted) play([880], { type: 'sine', gain: 0.025, duration: 0.08 });
        return muted;
      },
      isMuted: function isMuted() {
        return muted;
      },
    });
  })();

  let game = Snake.createGame();
  let boardSize = 0;
  let cellSize = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let particles = [];
  let foodBornAt = performance.now();
  let deathFlash = 0;
  let scoreBumpTimer = 0;
  let shakeTimer = 0;
  let swipeStart = null;

  function syncHud() {
    els.score.textContent = String(game.score);
    els.best.textContent = String(best);
    els.level.textContent = String(Snake.level(game));
  }

  function syncPauseButton() {
    const canPause = game.status === 'running' || game.status === 'paused';
    const paused = game.status === 'paused';
    els.pause.disabled = !canPause;
    els.pause.setAttribute('aria-label', paused ? '继续游戏' : '暂停游戏');
    els.pause.title = paused ? '继续游戏 (Space)' : '暂停游戏 (Space)';
    els.pauseIcon.hidden = paused;
    els.playIcon.hidden = !paused;
  }

  function syncSoundButton() {
    const muted = Sound.isMuted();
    els.soundOnIcon.hidden = muted;
    els.soundOffIcon.hidden = !muted;
    els.sound.setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
    els.sound.title = muted ? '开启音效 (M)' : '关闭音效 (M)';
  }

  function overlayCopy(kind, isRecord) {
    if (kind === 'paused') {
      return {
        eyebrow: '休息一下',
        title: '已暂停',
        desc: '按空格或点击「继续游戏」回到棋盘。',
        score: '',
        action: '继续游戏',
      };
    }
    if (kind === 'over') {
      return {
        eyebrow: isRecord ? '新纪录' : '本局结束',
        title: '游戏结束',
        desc: game.overReason === 'self' ? '咬到自己的尾巴了，再来一局？' : '撞到墙了，再来一局？',
        score: '本局得分 ' + game.score + ' · 最高分 ' + best,
        action: '再来一局',
      };
    }
    if (kind === 'won') {
      return {
        eyebrow: '满屏通关',
        title: '太厉害了！',
        desc: '整块棋盘都被你填满了，这是贪吃蛇的极限。',
        score: '本局得分 ' + game.score + ' · 最高分 ' + best,
        action: '再来一局',
      };
    }
    return {
      eyebrow: '准备好了吗？',
      title: '霓虹贪吃蛇',
      desc: '吃掉光点，蛇身会越来越长。用方向键 / WASD 或滑动棋盘控制，别撞墙，也别咬到自己。',
      score: '',
      action: '开始游戏',
    };
  }

  function showOverlay(kind, isRecord) {
    const copy = overlayCopy(kind, isRecord);
    els.overlayEyebrow.textContent = copy.eyebrow;
    els.overlayTitle.textContent = copy.title;
    els.overlayDesc.textContent = copy.desc;
    els.overlayScore.textContent = copy.score;
    els.overlayScore.hidden = !copy.score;
    els.action.textContent = copy.action;
    els.overlay.dataset.kind = kind;
    els.overlay.hidden = false;
  }

  function hideOverlay() {
    els.overlay.hidden = true;
    els.overlay.dataset.kind = 'playing';
    const active = document.activeElement;
    if (active && els.overlay.contains(active) && typeof active.blur === 'function') active.blur();
  }

  function beginGame() {
    game = Snake.createGame();
    Snake.start(game);
    accumulator = 0;
    particles = [];
    deathFlash = 0;
    foodBornAt = performance.now();
    hideOverlay();
    syncHud();
    syncPauseButton();
    Sound.start();
  }

  function pauseGame() {
    if (Snake.togglePause(game) !== 'paused') return;
    showOverlay('paused');
    syncPauseButton();
  }

  function resumeGame() {
    if (Snake.togglePause(game) !== 'running') return;
    hideOverlay();
    accumulator = 0;
    syncPauseButton();
  }

  function togglePlay() {
    if (game.status === 'running') {
      pauseGame();
    } else if (game.status === 'paused') {
      resumeGame();
    } else {
      beginGame();
    }
  }

  function finishGame(result) {
    const isRecord = game.score > best;
    if (isRecord) {
      best = game.score;
      writeStorage(STORAGE_BEST, best);
    }
    deathFlash = result.won ? 0 : 1;
    if (result.won) {
      Sound.win();
    } else {
      Sound.die();
    }
    if (!reduceMotion && !result.won) {
      els.wrap.classList.remove('is-shaking');
      void els.wrap.offsetWidth;
      els.wrap.classList.add('is-shaking');
      clearTimeout(shakeTimer);
      shakeTimer = window.setTimeout(function stopShake() {
        els.wrap.classList.remove('is-shaking');
      }, 420);
    }
    syncHud();
    syncPauseButton();
    showOverlay(result.won ? 'won' : 'over', isRecord);
  }

  function bumpScore() {
    els.score.classList.remove('is-bumping');
    void els.score.offsetWidth;
    els.score.classList.add('is-bumping');
    clearTimeout(scoreBumpTimer);
    scoreBumpTimer = window.setTimeout(function stopBump() {
      els.score.classList.remove('is-bumping');
    }, 260);
  }

  function steer(direction) {
    if (game.status === 'ready') beginGame();
    if (game.status === 'running') Snake.setDirection(game, direction);
  }

  function toggleSound() {
    Sound.toggle();
    syncSoundButton();
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    const target = event.target;
    const onButton = target instanceof Element && target.closest('button');

    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
      if (onButton) return;
      event.preventDefault();
      if (key === 'Enter') {
        if (game.status === 'paused') {
          resumeGame();
        } else if (game.status !== 'running') {
          beginGame();
        }
      } else {
        togglePlay();
      }
      return;
    }

    if (key === 'm' || key === 'M') {
      toggleSound();
      return;
    }

    if (key === 'p' || key === 'P') {
      if (game.status === 'running' || game.status === 'paused') {
        event.preventDefault();
        togglePlay();
      }
      return;
    }

    const keyDirections = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      W: 'up',
      s: 'down',
      S: 'down',
      a: 'left',
      A: 'left',
      d: 'right',
      D: 'right',
    };
    const direction = keyDirections[key];
    if (!direction) return;
    event.preventDefault();
    steer(direction);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse') return;
    swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event) {
    if (!swipeStart || swipeStart.id !== event.pointerId) return;
    const start = swipeStart;
    swipeStart = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 24) return;
    if (game.status === 'ready') beginGame();
    if (game.status !== 'running') return;
    const direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    Snake.setDirection(game, direction);
  }

  function measureBoard() {
    const rect = els.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(rect.width * dpr);
    if (els.canvas.width !== pixelWidth || els.canvas.height !== pixelWidth) {
      els.canvas.width = pixelWidth;
      els.canvas.height = pixelWidth;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardSize = rect.width;
    cellSize = boardSize / game.cols;
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function hexToRgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  const BODY_START = hexToRgb('#22d3ee');
  const BODY_END = hexToRgb('#8b5cf6');

  function bodyColor(t) {
    const r = Math.round(BODY_START[0] + (BODY_END[0] - BODY_START[0]) * t);
    const g = Math.round(BODY_START[1] + (BODY_END[1] - BODY_START[1]) * t);
    const b = Math.round(BODY_START[2] + (BODY_END[2] - BODY_START[2]) * t);
    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
  }

  function drawBackdrop() {
    const background = ctx.createLinearGradient(0, 0, boardSize, boardSize);
    background.addColorStop(0, '#0a1428');
    background.addColorStop(0.55, '#0a1122');
    background.addColorStop(1, '#0d1026');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, boardSize, boardSize);

    const glow = ctx.createRadialGradient(
      boardSize * 0.5,
      boardSize * 0.12,
      0,
      boardSize * 0.5,
      boardSize * 0.12,
      boardSize * 0.85
    );
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.10)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, boardSize, boardSize);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.065)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < game.cols; x += 1) {
      const px = Math.round(x * cellSize) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, boardSize);
    }
    for (let y = 1; y < game.rows; y += 1) {
      const py = Math.round(y * cellSize) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(boardSize, py);
    }
    ctx.stroke();
  }

  function drawFood(now) {
    if (!game.food) return;
    const cx = (game.food.x + 0.5) * cellSize;
    const cy = (game.food.y + 0.5) * cellSize;
    const grow = Math.min(1, (now - foodBornAt) / 260);
    const eased = 1 - Math.pow(1 - grow, 3);
    const pulse = 1 + Math.sin(now / 320) * 0.05;
    const radius = cellSize * 0.3 * (0.55 + 0.45 * eased) * pulse;

    ctx.save();
    ctx.shadowColor = 'rgba(251, 113, 133, 0.85)';
    ctx.shadowBlur = cellSize * 0.95;
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(251, 113, 133, ' + (0.18 + 0.1 * Math.sin(now / 500)) + ')';
    ctx.lineWidth = Math.max(1, cellSize * 0.055);
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.43, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(254, 205, 211, 0.9)';
    ctx.beginPath();
    ctx.arc(cx - radius * 0.32, cy - radius * 0.34, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(cx + radius * 0.55, cy - radius * 0.9, radius * 0.42, radius * 0.19, -0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSnake() {
    const length = game.snake.length;
    for (let index = length - 1; index >= 0; index -= 1) {
      const segment = game.snake[index];
      const t = length > 1 ? index / (length - 1) : 0;
      const inset = cellSize * 0.09;
      const x = segment.x * cellSize + inset;
      const y = segment.y * cellSize + inset;
      const size = cellSize - inset * 2;
      ctx.fillStyle = bodyColor(t);
      roundRectPath(ctx, x, y, size, size, size * 0.32);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      roundRectPath(ctx, x + size * 0.16, y + size * 0.13, size * 0.68, size * 0.2, size * 0.1);
      ctx.fill();
    }

    const head = game.snake[0];
    const inset = cellSize * 0.07;
    const hx = head.x * cellSize + inset;
    const hy = head.y * cellSize + inset;
    const hs = cellSize - inset * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(94, 234, 212, 0.6)';
    ctx.shadowBlur = cellSize * 0.85;
    ctx.fillStyle = '#5eead4';
    roundRectPath(ctx, hx, hy, hs, hs, hs * 0.32);
    ctx.fill();
    ctx.restore();

    const direction = game.direction;
    const centerX = (head.x + 0.5) * cellSize;
    const centerY = (head.y + 0.5) * cellSize;
    const sideX = -direction.y;
    const sideY = direction.x;
    const eyeRadius = cellSize * 0.105;
    const pupilRadius = cellSize * 0.052;

    for (let side = -1; side <= 1; side += 2) {
      const ex = centerX + direction.x * cellSize * 0.17 + sideX * side * cellSize * 0.19;
      const ey = centerY + direction.y * cellSize * 0.17 + sideY * side * cellSize * 0.19;
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(ex, ey, eyeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(
        ex + direction.x * cellSize * 0.035,
        ey + direction.y * cellSize * 0.035,
        pupilRadius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  function drawParticles() {
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.4 + alpha * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    if (!boardSize) return;
    ctx.clearRect(0, 0, boardSize, boardSize);
    drawBackdrop();
    drawFood(now);
    drawSnake();
    drawParticles();
    if (deathFlash > 0) {
      ctx.fillStyle = 'rgba(248, 113, 113, ' + deathFlash * 0.18 + ')';
      ctx.fillRect(0, 0, boardSize, boardSize);
    }
  }

  function spawnBurst(cell) {
    const cx = (cell.x + 0.5) * cellSize;
    const cy = (cell.y + 0.5) * cellSize;
    const colors = ['#fb7185', '#fda4af', '#fbbf24', '#f8fafc'];
    const count = reduceMotion ? 6 : 16;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (40 + Math.random() * 150) * (cellSize / 23);
      const life = 0.35 + Math.random() * 0.4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: life,
        maxLife: life,
        size: cellSize * (0.05 + Math.random() * 0.07),
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    if (particles.length > MAX_PARTICLES) {
      particles.splice(0, particles.length - MAX_PARTICLES);
    }
  }

  function updateParticles(dt) {
    const seconds = dt / 1000;
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life -= seconds;
      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      const drag = Math.exp(-2.6 * seconds);
      particle.vx *= drag;
      particle.vy = particle.vy * drag + 24 * seconds;
    }
  }

  function frame(now) {
    const dt = lastFrame ? Math.min(now - lastFrame, 200) : 0;
    lastFrame = now;

    if (game.status === 'running') {
      accumulator += dt;
      let steps = 0;
      while (game.status === 'running' && accumulator >= Snake.tickMs(game) && steps < 5) {
        const tick = Snake.tickMs(game);
        const eatenAt = game.food;
        const result = Snake.step(game);
        accumulator -= tick;
        steps += 1;
        if (result.eaten && eatenAt) {
          spawnBurst(eatenAt);
          foodBornAt = now;
          Sound.eat();
          bumpScore();
          syncHud();
        }
        if (result.over || result.won) {
          finishGame(result);
          break;
        }
      }
    }

    if (deathFlash > 0) {
      deathFlash = Math.max(0, deathFlash - dt / 500);
    }
    updateParticles(dt);
    draw(now);
    window.requestAnimationFrame(frame);
  }

  els.action.addEventListener('click', function onPrimaryAction() {
    if (game.status === 'paused') {
      resumeGame();
    } else {
      beginGame();
    }
  });

  els.pause.addEventListener('click', function onPauseClick() {
    if (game.status === 'running' || game.status === 'paused') togglePlay();
  });

  els.sound.addEventListener('click', toggleSound);

  els.dpad.addEventListener('click', function onDpadClick(event) {
    const button = event.target.closest('button[data-dir]');
    if (!button) return;
    button.blur();
    steer(button.dataset.dir);
  });

  els.wrap.addEventListener('pointerdown', onPointerDown);
  els.wrap.addEventListener('pointerup', onPointerUp);
  els.wrap.addEventListener('pointercancel', function resetSwipe() {
    swipeStart = null;
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', function onVisibilityChange() {
    if (document.hidden && game.status === 'running') {
      pauseGame();
    }
  });

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(function onResize() {
      measureBoard();
    });
    resizeObserver.observe(els.canvas);
  }
  window.addEventListener('resize', measureBoard);

  measureBoard();
  syncHud();
  syncPauseButton();
  syncSoundButton();
  showOverlay('ready');
  window.requestAnimationFrame(frame);
})();
