const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hpText = document.getElementById('hpText');
const scoreText = document.getElementById('scoreText');
const levelText = document.getElementById('levelText');

const keys = {};
const mouse = { x: canvas.width * 0.5, y: canvas.height * 0.5, down: false };

const world = {
  width: 2200,
  height: 1800,
};

const camera = {
  x: 0,
  y: 0,
};

const player = {
  x: world.width / 2,
  y: world.height / 2,
  radius: 20,
  speed: 240,
  angle: 0,
  hp: 100,
  maxHp: 100,
  fireCooldown: 0,
  score: 0,
  level: 1,
};

const projectiles = [];
const enemies = [];
const trees = [];
let lastTimestamp = 0;
let spawnTimer = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function generateTrees() {
  for (let i = 0; i < 70; i++) {
    trees.push({
      x: Math.random() * world.width,
      y: Math.random() * world.height,
      radius: 18 + Math.random() * 26,
    });
  }
}

function spawnEnemy() {
  const margin = 90;
  const side = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;

  if (side === 0) {
    x = Math.random() * world.width;
    y = -margin;
  } else if (side === 1) {
    x = world.width + margin;
    y = Math.random() * world.height;
  } else if (side === 2) {
    x = Math.random() * world.width;
    y = world.height + margin;
  } else {
    x = -margin;
    y = Math.random() * world.height;
  }

  enemies.push({
    x,
    y,
    radius: 16,
    speed: 55 + Math.random() * 45,
    hp: 1,
  });
}

function shoot() {
  if (player.fireCooldown > 0) return;

  const dx = mouse.x - canvas.width / 2;
  const dy = mouse.y - canvas.height / 2;
  const length = Math.hypot(dx, dy) || 1;

  projectiles.push({
    x: player.x + (dx / length) * 28,
    y: player.y + (dy / length) * 28,
    vx: (dx / length) * 550,
    vy: (dy / length) * 550,
    radius: 5,
    life: 1.4,
  });

  player.fireCooldown = 0.22;
}

function updateCamera() {
  camera.x = clamp(player.x - canvas.width / 2, 0, world.width - canvas.width);
  camera.y = clamp(player.y - canvas.height / 2, 0, world.height - canvas.height);
}

function updatePlayer(delta) {
  let moveX = 0;
  let moveY = 0;

  if (keys['KeyW'] || keys['ArrowUp']) moveY -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) moveY += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;

  if (moveX !== 0 || moveY !== 0) {
    const length = Math.hypot(moveX, moveY) || 1;
    moveX = (moveX / length) * player.speed;
    moveY = (moveY / length) * player.speed;
  }

  const nextX = clamp(player.x + moveX * delta, player.radius, world.width - player.radius);
  const nextY = clamp(player.y + moveY * delta, player.radius, world.height - player.radius);

  const collidesTree = trees.some((tree) => {
    const dx = nextX - tree.x;
    const dy = nextY - tree.y;
    return Math.hypot(dx, dy) < player.radius + tree.radius;
  });

  if (!collidesTree) {
    player.x = nextX;
    player.y = nextY;
  }

  const dx = mouse.x - canvas.width / 2;
  const dy = mouse.y - canvas.height / 2;
  player.angle = Math.atan2(dy, dx);

  if (player.fireCooldown > 0) {
    player.fireCooldown -= delta;
  }

  if (mouse.down || keys['Space']) {
    shoot();
  }

  updateCamera();
}

function updateProjectiles(delta) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * delta;
    p.y += p.vy * delta;
    p.life -= delta;

    if (
      p.x < -30 ||
      p.x > world.width + 30 ||
      p.y < -30 ||
      p.y > world.height + 30 ||
      p.life <= 0
    ) {
      projectiles.splice(i, 1);
      continue;
    }

    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];
      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const dist = Math.hypot(dx, dy);

      if (dist < p.radius + enemy.radius) {
        enemies.splice(j, 1);
        projectiles.splice(i, 1);
        player.score += 10;
        break;
      }
    }
  }
}

function updateEnemies(delta) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const length = Math.hypot(dx, dy) || 1;

    enemy.x += (dx / length) * enemy.speed * delta;
    enemy.y += (dy / length) * enemy.speed * delta;

    const hit = Math.hypot(player.x - enemy.x, player.y - enemy.y) < player.radius + enemy.radius;
    if (hit) {
      player.hp = Math.max(0, player.hp - 20 * delta);
      if (player.hp <= 0) {
        player.hp = player.maxHp;
        player.score = 0;
        player.level = 1;
        enemies.length = 0;
        projectiles.length = 0;
        player.x = world.width / 2;
        player.y = world.height / 2;
      }
    }
  }

  if (player.score >= player.level * 100) {
    player.level += 1;
    player.hp = player.maxHp;
  }
}

function drawWorld() {
  const worldOffsetX = -camera.x;
  const worldOffsetY = -camera.y;

  ctx.fillStyle = '#163c2d';
  ctx.fillRect(worldOffsetX, worldOffsetY, world.width, world.height);

  ctx.fillStyle = '#1d4d39';
  for (let i = 0; i < 40; i++) {
    const x = (i * 150) % world.width;
    const y = (i * 83) % world.height;
    ctx.fillRect(worldOffsetX + x, worldOffsetY + y, 120, 30);
  }

  trees.forEach((tree) => {
    const screenX = tree.x - camera.x;
    const screenY = tree.y - camera.y;

    ctx.fillStyle = '#3d2a1a';
    ctx.beginPath();
    ctx.arc(screenX, screenY, tree.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2e7d4a';
    ctx.beginPath();
    ctx.arc(screenX, screenY - tree.radius * 0.2, tree.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlayer() {
  const screenX = player.x - camera.x;
  const screenY = player.y - camera.y;

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(player.angle);

  ctx.fillStyle = '#a9d9ff';
  ctx.beginPath();
  ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#e8f4ff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(player.radius + 22, 0);
  ctx.stroke();

  ctx.fillStyle = '#f3d07c';
  ctx.fillRect(player.radius + 8, -4, 16, 8);

  ctx.restore();
}

function drawEnemies() {
  enemies.forEach((enemy) => {
    const screenX = enemy.x - camera.x;
    const screenY = enemy.y - camera.y;

    ctx.fillStyle = '#ff636a';
    ctx.beginPath();
    ctx.arc(screenX, screenY, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawProjectiles() {
  projectiles.forEach((p) => {
    const screenX = p.x - camera.x;
    const screenY = p.y - camera.y;

    ctx.fillStyle = '#f3d07c';
    ctx.beginPath();
    ctx.arc(screenX, screenY, p.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHealthBar() {
  const x = 20;
  const y = 20;
  const width = 180;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, width, 18);

  ctx.fillStyle = '#74edb0';
  ctx.fillRect(x, y, (player.hp / player.maxHp) * width, 18);

  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.strokeRect(x, y, width, 18);
}

function render() {
  drawWorld();
  drawProjectiles();
  drawEnemies();
  drawPlayer();
  drawHealthBar();

  hpText.textContent = `HP: ${Math.ceil(player.hp)}`;
  scoreText.textContent = `Puntuación: ${player.score}`;
  levelText.textContent = `Nivel ${player.level}`;
}

function update(delta) {
  updatePlayer(delta);
  updateProjectiles(delta);
  updateEnemies(delta);

  spawnTimer -= delta;
  if (spawnTimer <= 0) {
    spawnTimer = 1.3 - Math.min(player.level * 0.08, 0.7);
    if (enemies.length < 12 + player.level) {
      spawnEnemy();
    }
  }
}

function gameLoop(timestamp) {
  const delta = Math.min((timestamp - lastTimestamp) / 1000 || 0, 0.033);
  lastTimestamp = timestamp;

  update(delta);
  render();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (event) => {
  keys[event.code] = true;
  if (event.code === 'Space') {
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  mouse.x = (event.clientX - rect.left) * scaleX;
  mouse.y = (event.clientY - rect.top) * scaleY;
});

canvas.addEventListener('mousedown', () => {
  mouse.down = true;
  shoot();
});

canvas.addEventListener('mouseup', () => {
  mouse.down = false;
});

canvas.addEventListener('mouseleave', () => {
  mouse.down = false;
});

generateTrees();
requestAnimationFrame(gameLoop);
