// ── Pong+ ──────────────────────────────────────────────────────────────────────
// A pong game with shields and guns.  Touch-optimised for iPhone.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ── Sizing ─────────────────────────────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener('resize', resize);
resize();

// Coordinate helpers – everything is stored in "game units" where the court is
// 400 wide × 700 tall, centred on the canvas.
function courtMetrics() {
  const cw = canvas.width, ch = canvas.height;
  const aspect = 400 / 700;
  let w, h;
  if (cw / ch > aspect) { h = ch; w = h * aspect; }
  else { w = cw; h = w / aspect; }
  return { ox: (cw - w) / 2, oy: (ch - h) / 2, w, h, scale: w / 400 };
}

function toCanvas(gx, gy) {
  const m = courtMetrics();
  return [m.ox + gx * m.scale, m.oy + gy * m.scale];
}

function fromCanvas(cx, cy) {
  const m = courtMetrics();
  return [(cx - m.ox) / m.scale, (cy - m.oy) / m.scale];
}

// ── Constants ──────────────────────────────────────────────────────────────────
const COURT_W = 400;
const COURT_H = 700;
const PADDLE_W = 60;
const PADDLE_H = 10;
const BALL_R = 5;
const SHIELD_R = 50;          // semicircle radius around paddle centre
const BULLET_R = 2;           // bullet half-width (creates 4px holes)
const BULLET_SPEED = 8;       // game-units per frame
const WIN_SCORE = 11;
const AI_SPEED = 3.2;
const BALL_START_SPEED = 3.5;
const BALL_MAX_SPEED = 7;
const GUN_LEN = 10;           // visual length of gun barrel

// ── State ──────────────────────────────────────────────────────────────────────
let player, ai, ball, bullets, state, serveDir;

function newPaddle(y, isTop) {
  return {
    x: COURT_W / 2,
    y,
    w: PADDLE_W,
    h: PADDLE_H,
    score: 0,
    isTop,
    // Shield: array of { start, end } arcs in radians that are INTACT.
    // For bottom paddle the shield arcs from π to 2π (semicircle above).
    // For top paddle the shield arcs from 0 to π (semicircle below).
    shieldArcs: isTop
      ? [{ start: 0, end: Math.PI }]
      : [{ start: Math.PI, end: Math.PI * 2 }],
    // Paddle holes: array of { pos, width } where pos is x-offset from paddle
    // left edge
    holes: [],
  };
}

function resetRound() {
  player = newPaddle(COURT_H - 40, false);
  ai = newPaddle(40, true);
  // preserve scores
  if (arguments.length === 2) {
    player.score = arguments[0];
    ai.score = arguments[1];
  }
  bullets = [];
  serveBall();
}

function serveBall() {
  const angle = (Math.random() * 0.8 + 0.1) * Math.PI; // 0.1π–0.9π
  const spd = BALL_START_SPEED;
  ball = {
    x: COURT_W / 2,
    y: COURT_H / 2,
    vx: Math.cos(angle) * spd * (Math.random() < 0.5 ? 1 : -1),
    vy: spd * serveDir,
    speed: spd,
  };
}

function initGame() {
  serveDir = -1; // serve toward AI first
  state = 'playing';
  resetRound();
}

initGame();

// ── Touch handling (relative drag + tap to shoot) ──────────────────────────────
let touchId = null;
let lastTouchY = null;
let lastTouchX = null;
let touchMoved = false;

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (state === 'gameover') { initGame(); return; }
  const t = e.changedTouches[0];
  if (touchId === null) {
    touchId = t.identifier;
    lastTouchX = t.clientX * devicePixelRatio;
    lastTouchY = t.clientY * devicePixelRatio;
    touchMoved = false;
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touchId) {
      const cx = t.clientX * devicePixelRatio;
      const cy = t.clientY * devicePixelRatio;
      const m = courtMetrics();
      const dx = (cx - lastTouchX) / m.scale;
      const dy = (cy - lastTouchY) / m.scale;
      player.x = Math.max(PADDLE_W / 2, Math.min(COURT_W - PADDLE_W / 2, player.x + dx));
      // Optionally allow slight vertical movement (clamped)
      lastTouchX = cx;
      lastTouchY = cy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) touchMoved = true;
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touchId) {
      // Tap (no significant drag) → shoot
      if (!touchMoved && state === 'playing') {
        shootBullet(player);
      }
      touchId = null;
      lastTouchX = null;
      lastTouchY = null;
    }
  }
}, { passive: false });

// ── Bullet logic ───────────────────────────────────────────────────────────────
function shootBullet(paddle) {
  bullets.push({
    x: paddle.x,
    y: paddle.isTop ? paddle.y + PADDLE_H / 2 + GUN_LEN : paddle.y - PADDLE_H / 2 - GUN_LEN,
    vy: paddle.isTop ? BULLET_SPEED : -BULLET_SPEED,
    owner: paddle,
  });
}

// AI shooting cooldown
let aiShootTimer = 0;
const AI_SHOOT_INTERVAL = 90; // frames

// ── Shield hole logic ──────────────────────────────────────────────────────────
// Remove an angular slice from the shield arcs.
function punchShieldHole(paddle, angle, halfWidth) {
  const lo = angle - halfWidth;
  const hi = angle + halfWidth;
  const newArcs = [];
  for (const arc of paddle.shieldArcs) {
    // No overlap
    if (hi <= arc.start || lo >= arc.end) {
      newArcs.push(arc);
      continue;
    }
    // Left remainder
    if (lo > arc.start) newArcs.push({ start: arc.start, end: lo });
    // Right remainder
    if (hi < arc.end) newArcs.push({ start: hi, end: arc.end });
  }
  paddle.shieldArcs = newArcs;
}

// Check if an angle is blocked by shield arcs.
function shieldBlocksAngle(paddle, angle) {
  for (const arc of paddle.shieldArcs) {
    if (angle >= arc.start && angle <= arc.end) return true;
  }
  return false;
}

// ── Paddle hole logic ──────────────────────────────────────────────────────────
function punchPaddleHole(paddle, xHit, width) {
  paddle.holes.push({ pos: xHit - paddle.x + paddle.w / 2, width });
  // merge overlapping
  paddle.holes.sort((a, b) => a.pos - b.pos);
}

function paddleBlocksBall(paddle, bx) {
  const rel = bx - (paddle.x - paddle.w / 2);
  for (const h of paddle.holes) {
    if (rel >= h.pos - h.width / 2 && rel <= h.pos + h.width / 2) return false;
  }
  return true;
}

// ── Collision helpers ──────────────────────────────────────────────────────────
function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX, dy = cy - nearY;
  return dx * dx + dy * dy <= r * r;
}

// ── Main update ────────────────────────────────────────────────────────────────
function update() {
  if (state !== 'playing') return;

  // ── AI movement ──────────────────────────────────────────────────────────────
  const target = ball.vy < 0 ? ball.x : COURT_W / 2;
  const diff = target - ai.x;
  if (Math.abs(diff) > AI_SPEED) ai.x += Math.sign(diff) * AI_SPEED;
  else ai.x = target;
  ai.x = Math.max(PADDLE_W / 2, Math.min(COURT_W - PADDLE_W / 2, ai.x));

  // AI shoot
  aiShootTimer++;
  if (aiShootTimer >= AI_SHOOT_INTERVAL) {
    aiShootTimer = 0;
    shootBullet(ai);
  }

  // ── Bullets ──────────────────────────────────────────────────────────────────
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const prevY = b.y;
    b.y += b.vy;
    // Off screen
    if (b.y < -20 || b.y > COURT_H + 20) { bullets.splice(i, 1); continue; }

    // Check collision with the *opponent's* shield then paddle
    const target = b.owner === player ? ai : player;
    const dx = b.x - target.x;
    const dy = b.y - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Swept shield collision — check if bullet crossed the shield radius
    const prevDy = prevY - target.y;
    const prevDist = Math.sqrt(dx * dx + prevDy * prevDy);
    const crossedShield = (prevDist >= SHIELD_R && dist <= SHIELD_R) ||
                          (prevDist <= SHIELD_R && dist >= SHIELD_R) ||
                          (dist <= SHIELD_R + BULLET_R && dist >= SHIELD_R - BULLET_R - 2);

    if (crossedShield) {
      // Find the y where bullet crosses shield radius for accurate angle
      const hitY = (prevDist >= SHIELD_R) ? target.y + Math.sign(dy) * Math.sqrt(SHIELD_R * SHIELD_R - dx * dx) : b.y;
      const hitDy = (isNaN(hitY) ? dy : hitY - target.y);
      const angle = Math.atan2(hitDy, dx);
      const normAngle = angle < 0 ? angle + Math.PI * 2 : angle;
      if (shieldBlocksAngle(target, normAngle)) {
        const holeHalf = Math.atan2(BULLET_R * 2, SHIELD_R);
        punchShieldHole(target, normAngle, holeHalf);
        bullets.splice(i, 1);
        continue;
      }
    }

    // Paddle collision
    const px = target.x - target.w / 2;
    const py = target.y - target.h / 2;
    if (b.x >= px && b.x <= px + target.w &&
        b.y >= py && b.y <= py + target.h) {
      punchPaddleHole(target, b.x, BULLET_R * 2);
      bullets.splice(i, 1);
      continue;
    }
  }

  // ── Ball movement ────────────────────────────────────────────────────────────
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Wall bounce
  if (ball.x - BALL_R <= 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
  if (ball.x + BALL_R >= COURT_W) { ball.x = COURT_W - BALL_R; ball.vx = -Math.abs(ball.vx); }

  // ── Shield bounce / pass-through ────────────────────────────────────────────
  for (const paddle of [player, ai]) {
    const dx = ball.x - paddle.x;
    const dy = ball.y - paddle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= SHIELD_R - BALL_R && dist <= SHIELD_R + BALL_R) {
      const angle = Math.atan2(dy, dx);
      const normAngle = angle < 0 ? angle + Math.PI * 2 : angle;
      if (shieldBlocksAngle(paddle, normAngle)) {
        // Bounce off shield
        const nx = dx / dist, ny = dy / dist;
        const dot = ball.vx * nx + ball.vy * ny;
        // Only bounce if moving toward shield centre (inward)
        if (dot < 0) {
          ball.vx -= 2 * dot * nx;
          ball.vy -= 2 * dot * ny;
          // push ball out
          ball.x = paddle.x + nx * (SHIELD_R + BALL_R + 1);
          ball.y = paddle.y + ny * (SHIELD_R + BALL_R + 1);
        }
      }
    }
  }

  // ── Paddle bounce / pass-through ─────────────────────────────────────────────
  for (const paddle of [player, ai]) {
    const px = paddle.x - paddle.w / 2;
    const py = paddle.y - paddle.h / 2;
    if (circleRectOverlap(ball.x, ball.y, BALL_R, px, py, paddle.w, paddle.h)) {
      if (!paddleBlocksBall(paddle, ball.x)) continue; // slips through hole
      // Bounce
      const relX = (ball.x - paddle.x) / (paddle.w / 2); // -1 to 1
      const angle = relX * (Math.PI / 3); // max 60° deflection
      ball.speed = Math.min(ball.speed + 0.15, BALL_MAX_SPEED);
      const dir = paddle.isTop ? 1 : -1;
      ball.vx = Math.sin(angle) * ball.speed;
      ball.vy = Math.cos(angle) * ball.speed * dir;
      ball.y = paddle.isTop ? py + paddle.h + BALL_R + 1 : py - BALL_R - 1;
    }
  }

  // ── Scoring ──────────────────────────────────────────────────────────────────
  if (ball.y - BALL_R <= 0) {
    player.score++;
    afterPoint();
  } else if (ball.y + BALL_R >= COURT_H) {
    ai.score++;
    afterPoint();
  }
}

function afterPoint() {
  if (player.score >= WIN_SCORE || ai.score >= WIN_SCORE) {
    state = 'gameover';
    return;
  }
  serveDir = ball.vy > 0 ? -1 : 1;
  const ps = player.score, as_ = ai.score;
  resetRound(ps, as_);
}

// ── Drawing ────────────────────────────────────────────────────────────────────
function draw() {
  const m = courtMetrics();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Court background
  ctx.fillStyle = '#111';
  ctx.fillRect(m.ox, m.oy, m.w, m.h);

  // Centre line
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1 * m.scale;
  ctx.setLineDash([6 * m.scale, 6 * m.scale]);
  ctx.beginPath();
  const [clx, cly] = toCanvas(0, COURT_H / 2);
  const [clx2] = toCanvas(COURT_W, COURT_H / 2);
  ctx.moveTo(clx, cly);
  ctx.lineTo(clx2, cly);
  ctx.stroke();
  ctx.setLineDash([]);

  // Scores
  ctx.fillStyle = '#555';
  ctx.font = `bold ${32 * m.scale}px monospace`;
  ctx.textAlign = 'center';
  const [sx, sy1] = toCanvas(COURT_W / 2, COURT_H / 2 - 30);
  const [, sy2] = toCanvas(0, COURT_H / 2 + 50);
  ctx.fillText(ai.score, sx, sy1);
  ctx.fillText(player.score, sx, sy2);

  // Draw paddles, shields, guns
  for (const paddle of [player, ai]) {
    const [px, py] = toCanvas(paddle.x - paddle.w / 2, paddle.y - paddle.h / 2);
    const pw = paddle.w * m.scale;
    const ph = paddle.h * m.scale;
    const [cx, cy] = toCanvas(paddle.x, paddle.y);

    // Shield arcs
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2 * m.scale;
    const sr = SHIELD_R * m.scale;
    for (const arc of paddle.shieldArcs) {
      ctx.beginPath();
      ctx.arc(cx, cy, sr, arc.start, arc.end);
      ctx.stroke();
    }

    // Paddle (with holes visualised as gaps)
    ctx.fillStyle = '#fff';
    // Draw paddle as segments between holes
    const sortedHoles = [...paddle.holes].sort((a, b) => a.pos - b.pos);
    let drawStart = 0;
    for (const hole of sortedHoles) {
      const hs = hole.pos - hole.width / 2;
      const he = hole.pos + hole.width / 2;
      if (hs > drawStart) {
        const [sx2, sy] = toCanvas(paddle.x - paddle.w / 2 + drawStart, paddle.y - paddle.h / 2);
        ctx.fillRect(sx2, sy, (hs - drawStart) * m.scale, ph);
      }
      drawStart = he;
    }
    if (drawStart < paddle.w) {
      const [sx2, sy] = toCanvas(paddle.x - paddle.w / 2 + drawStart, paddle.y - paddle.h / 2);
      ctx.fillRect(sx2, sy, (paddle.w - drawStart) * m.scale, ph);
    }

    // Gun barrel
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2 * m.scale;
    ctx.beginPath();
    const gunDir = paddle.isTop ? 1 : -1;
    const [gx1, gy1] = toCanvas(paddle.x, paddle.y);
    const [gx2, gy2] = toCanvas(paddle.x, paddle.y + GUN_LEN * gunDir);
    ctx.moveTo(gx1, gy1);
    ctx.lineTo(gx2, gy2);
    ctx.stroke();
  }

  // Bullets
  ctx.fillStyle = '#ff0';
  for (const b of bullets) {
    const [bx, by] = toCanvas(b.x, b.y);
    ctx.beginPath();
    ctx.arc(bx, by, BULLET_R * m.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ball
  ctx.fillStyle = '#fff';
  const [bx, by] = toCanvas(ball.x, ball.y);
  ctx.beginPath();
  ctx.arc(bx, by, BALL_R * m.scale, 0, Math.PI * 2);
  ctx.fill();

  // Game over overlay
  if (state === 'gameover') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(m.ox, m.oy, m.w, m.h);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${28 * m.scale}px monospace`;
    ctx.textAlign = 'center';
    const winner = player.score >= WIN_SCORE ? 'YOU WIN!' : 'AI WINS!';
    const [tx, ty] = toCanvas(COURT_W / 2, COURT_H / 2 - 10);
    ctx.fillText(winner, tx, ty);
    ctx.font = `${16 * m.scale}px monospace`;
    const [, ty2] = toCanvas(0, COURT_H / 2 + 30);
    ctx.fillText('Tap to play again', tx, ty2);
  }
}

// ── Loop ───────────────────────────────────────────────────────────────────────
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
