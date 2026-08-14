(() => {
  const ARENA = 56;
  const PLAYER_RADIUS = 0.55;
  const PLAYER_HEIGHT = 1.7;
  const CAM_DIST = 6.4;
  const MAG_SIZE = 30;
  const RESERVE_MAX = 90;

  const canvas = document.getElementById("scene");
  const hud = document.getElementById("hud");
  const menu = document.getElementById("menu");
  const pauseEl = document.getElementById("pause");
  const gameoverEl = document.getElementById("gameover");
  const startBtn = document.getElementById("start-btn");
  const resumeBtn = document.getElementById("resume-btn");
  const retryBtn = document.getElementById("retry-btn");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x081018);
  scene.fog = new THREE.Fog(0x081018, 18, 72);

  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );

  const clock = new THREE.Clock();
  const keys = {};
  const obstacles = [];
  const bullets = [];
  const enemyShots = [];
  const sparks = [];
  const enemies = [];
  const pickups = [];
  const raycaster = new THREE.Raycaster();
  const mouseNdc = new THREE.Vector2(0, 0);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  let running = false;
  let paused = false;
  let pointerLocked = false;
  let mouseDown = false;
  let yaw = 0;
  let pitch = 0.18;
  let shake = 0;
  let wave = 1;
  let score = 0;
  let kills = 0;
  let spawnTimer = 0;
  let remainingToSpawn = 0;
  let waveClearDelay = 0;
  let muzzleFlash = 0;

  const player = {
    group: new THREE.Group(),
    velocity: new THREE.Vector3(),
    health: 100,
    ammo: MAG_SIZE,
    reserve: RESERVE_MAX,
    reloading: false,
    reloadTime: 0,
    fireCooldown: 0,
    onGround: true,
    alive: true,
  };

  function makeMat(color, extra = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0.18,
      ...extra,
    });
  }

  function addBox(w, h, d, x, y, z, color, collides = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = collides ? "solid" : "deco";
    scene.add(mesh);
    if (collides) {
      obstacles.push({
        mesh,
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        height: h,
        y: y - h / 2,
      });
    }
    return mesh;
  }

  function buildArena() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      makeMat(0x1a2433)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.kind = "solid";
    scene.add(ground);

    const grid = new THREE.GridHelper(ARENA * 2, 40, 0x2c6a88, 0x163044);
    grid.position.y = 0.02;
    scene.add(grid);

    const wallH = 6;
    const wallT = 1.4;
    const half = ARENA;
    addBox(ARENA * 2, wallH, wallT, 0, wallH / 2, -half, 0x223044);
    addBox(ARENA * 2, wallH, wallT, 0, wallH / 2, half, 0x223044);
    addBox(wallT, wallH, ARENA * 2, -half, wallH / 2, 0, 0x223044);
    addBox(wallT, wallH, ARENA * 2, half, wallH / 2, 0, 0x223044);

    const covers = [
      [8, 1.4, 3.2, -10, 0.7, -6, 0x3a4d63],
      [3.2, 2.4, 8, 12, 1.2, 4, 0x3a4d63],
      [5, 1.1, 5, 0, 0.55, 12, 0x2f4258],
      [2.4, 3.2, 2.4, -16, 1.6, 10, 0x46586c],
      [2.4, 3.2, 2.4, 16, 1.6, -12, 0x46586c],
      [10, 1.2, 2, -4, 0.6, -16, 0x33485c],
      [2, 1.2, 10, 18, 0.6, 14, 0x33485c],
      [4, 2, 4, 6, 1, -10, 0x3d5368],
      [4, 2, 4, -18, 1, -2, 0x3d5368],
    ];
    covers.forEach((c) => addBox(...c));

    [-20, -8, 8, 20].forEach((x, i) => {
      const lamp = addBox(0.35, 5.2, 0.35, x, 2.6, i % 2 === 0 ? -22 : 22, 0x8899aa, false);
      const light = new THREE.PointLight(i % 2 ? 0xff9a4a : 0x66e0ff, 18, 18, 1.6);
      light.position.copy(lamp.position).add(new THREE.Vector3(0, 2.4, 0));
      scene.add(light);
    });
  }

  function makeCharacter(palette) {
    const root = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.62, 6, 12), makeMat(palette.body));
    torso.position.y = 1.05;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), makeMat(palette.head));
    head.position.y = 1.62;
    head.castShadow = true;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.08, 0.08),
      makeMat(palette.visor, { emissive: palette.visor, emissiveIntensity: 0.8 })
    );
    visor.position.set(0, 1.64, 0.16);
    const gun = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.42), makeMat(0x1c242e));
    stock.position.set(0.28, 1.12, 0.12);
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.55),
      makeMat(0x9ad8ea, { emissive: 0x2aa8c8, emissiveIntensity: 0.35 })
    );
    barrel.position.set(0.28, 1.18, 0.48);
    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.38, 4, 8), makeMat(palette.body));
    leftLeg.position.set(-0.16, 0.42, 0);
    leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.38, 4, 8), makeMat(palette.body));
    rightLeg.position.set(0.16, 0.42, 0);
    rightLeg.castShadow = true;
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 8), makeMat(palette.body));
    leftArm.position.set(-0.42, 1.18, 0.06);
    leftArm.rotation.z = 0.35;
    leftArm.castShadow = true;
    gun.add(stock, barrel);
    gun.name = "gun";
    root.add(torso, head, visor, leftLeg, rightLeg, leftArm, gun);
    root.userData.barrel = barrel;
    root.traverse((n) => {
      n.userData.owner = root;
    });
    return root;
  }

  function setupLights() {
    scene.add(new THREE.HemisphereLight(0x9ad4ff, 0x1a1510, 0.7));
    const sun = new THREE.DirectionalLight(0xffe6c8, 1.15);
    sun.position.set(18, 28, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    scene.add(sun);
    const fill = new THREE.PointLight(0x47c7ff, 22, 40, 1.4);
    fill.position.set(0, 8, 0);
    scene.add(fill);
  }

  function collides(x, z, radius) {
    if (Math.abs(x) > ARENA - 1.2 - radius || Math.abs(z) > ARENA - 1.2 - radius) return true;
    return obstacles.some((o) => {
      if (o.height < 0.8) return false;
      return (
        x + radius > o.minX &&
        x - radius < o.maxX &&
        z + radius > o.minZ &&
        z - radius < o.maxZ
      );
    });
  }

  function moveWithCollision(obj, vx, vz, radius) {
    const nx = obj.position.x + vx;
    const nz = obj.position.z + vz;
    if (!collides(nx, obj.position.z, radius)) obj.position.x = nx;
    if (!collides(obj.position.x, nz, radius)) obj.position.z = nz;
  }

  function aimPoint() {
    raycaster.setFromCamera(mouseNdc, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const h of hits) {
      if (!h.object.isMesh) continue;
      if (h.object.userData.owner === player.group) continue;
      const kind = objectKind(h.object);
      if (kind === "enemy" || kind === "solid") return h.point.clone();
    }
    return raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(80));
  }

  function spawnSpark(pos, color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    sparks.push({ mesh, life: 0.22 });
  }

  function fireTracer(from, to, color) {
    const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    scene.add(line);
    sparks.push({ mesh: line, life: 0.08 });
  }

  function updateHud() {
    document.getElementById("wave").textContent = String(wave);
    document.getElementById("score").textContent = String(score);
    document.getElementById("kills").textContent = String(kills);
    document.getElementById("hp-text").textContent = String(Math.max(0, Math.ceil(player.health)));
    document.getElementById("ammo").textContent = String(player.ammo);
    document.getElementById("reserve").textContent = String(player.reserve);
    const fill = document.getElementById("hp-fill");
    fill.style.width = `${Math.max(0, player.health)}%`;
    fill.classList.toggle("low", player.health <= 30);
    document.getElementById("low-hp").classList.toggle("on", player.health <= 30 && player.alive);
    document.getElementById("reload-hint").hidden = player.ammo > 0 || player.reloading || !player.alive;
  }

  function showBanner(text) {
    const el = document.getElementById("wave-banner");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(() => {
      el.hidden = true;
    }, 1600);
  }

  function hurtPlayer(amount) {
    if (!player.alive) return;
    player.health = Math.max(0, player.health - amount);
    document.getElementById("damage-flash").classList.remove("show");
    void document.getElementById("damage-flash").offsetWidth;
    document.getElementById("damage-flash").classList.add("show");
    shake = Math.min(0.35, shake + 0.12);
    updateHud();
    if (player.health <= 0) {
      player.alive = false;
      running = false;
      document.exitPointerLock();
      document.getElementById("result-text").textContent =
        `웨이브 ${wave} · 처치 ${kills} · 점수 ${score}`;
      gameoverEl.hidden = false;
      hud.hidden = true;
    }
  }

  function spawnEnemy(pos) {
    const root = makeCharacter({
      body: 0xb23b3b,
      head: 0x6a1f28,
      visor: 0xff6b4a,
    });
    root.position.copy(pos);
    root.userData.kind = "enemy";
    root.traverse((n) => {
      n.userData.kind = "enemy";
      n.userData.owner = root;
    });
    scene.add(root);
    enemies.push({
      root,
      health: 38 + wave * 6,
      speed: 3.3 + wave * 0.12,
      fireCd: 1.2,
      radius: 0.55,
      alive: true,
    });
  }

  function startWave() {
    remainingToSpawn = 2 + wave * 2;
    spawnTimer = 0.3;
    showBanner(`WAVE ${wave}`);
  }

  function randomSpawn() {
    for (let i = 0; i < 20; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 16 + Math.random() * 18;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (collides(x, z, 0.8)) continue;
      if (player.group.position.distanceTo(tmp.set(x, 0, z)) < 10) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(18, 0, 18);
  }

  function spawnPickup(pos, type) {
    const color = type === "hp" ? 0x4dffb0 : 0xffd166;
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38),
      makeMat(color, { emissive: color, emissiveIntensity: 0.7 })
    );
    mesh.position.copy(pos).setY(0.7);
    scene.add(mesh);
    pickups.push({ mesh, type, t: 0 });
  }

  function objectKind(obj) {
    let node = obj;
    while (node) {
      if (node.userData.kind) return node.userData.kind;
      node = node.parent;
    }
    return "";
  }

  function shoot() {
    if (!player.alive || player.reloading || player.fireCooldown > 0) return;
    if (player.ammo <= 0) {
      startReload();
      return;
    }
    player.ammo -= 1;
    player.fireCooldown = 0.11;
    muzzleFlash = 0.05;
    shake = Math.min(0.22, shake + 0.05);

    const from = new THREE.Vector3();
    player.group.userData.barrel.getWorldPosition(from);
    const aim = aimPoint();
    const dir = aim.clone().sub(from).normalize();
    raycaster.set(from, dir);
    const hits = raycaster.intersectObjects(scene.children, true);
    let end = from.clone().add(dir.clone().multiplyScalar(80));
    let hitEnemy = null;
    for (const h of hits) {
      if (!h.object.isMesh) continue;
      if (h.object.userData.owner === player.group) continue;
      const kind = objectKind(h.object);
      if (kind === "enemy") {
        hitEnemy = enemies.find((e) => e.alive && e.root === h.object.userData.owner);
        end = h.point;
        break;
      }
      if (kind === "solid") {
        end = h.point;
        break;
      }
    }

    fireTracer(from, end, 0x9af7ff);
    spawnSpark(end, 0x9af7ff);

    if (hitEnemy) {
      hitEnemy.health -= 22;
      document.getElementById("crosshair").classList.add("hit");
      const marker = document.getElementById("hit-marker");
      marker.classList.remove("show");
      void marker.offsetWidth;
      marker.classList.add("show");
      setTimeout(() => document.getElementById("crosshair").classList.remove("hit"), 80);
      if (hitEnemy.health <= 0) killEnemy(hitEnemy);
    }
    updateHud();
  }

  function killEnemy(enemy) {
    enemy.alive = false;
    kills += 1;
    score += 100 + wave * 20;
    scene.remove(enemy.root);
    spawnSpark(enemy.root.position.clone().setY(1.2), 0xff6b4a);
    if (Math.random() < 0.28) spawnPickup(enemy.root.position, Math.random() < 0.5 ? "hp" : "ammo");
    updateHud();
  }

  function startReload() {
    if (player.reloading || player.ammo === MAG_SIZE || player.reserve <= 0) return;
    player.reloading = true;
    player.reloadTime = 1.35;
  }

  function enemyShoot(enemy) {
    const from = enemy.root.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const to = player.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const dir = to.sub(from).normalize();
    const shot = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5533 })
    );
    shot.position.copy(from);
    scene.add(shot);
    enemyShots.push({ mesh: shot, vel: dir.multiplyScalar(22), life: 2.2 });
  }

  function resetGame() {
    enemies.splice(0).forEach((e) => scene.remove(e.root));
    pickups.splice(0).forEach((p) => scene.remove(p.mesh));
    bullets.splice(0).forEach((b) => scene.remove(b.mesh));
    enemyShots.splice(0).forEach((s) => scene.remove(s.mesh));
    sparks.splice(0).forEach((s) => scene.remove(s.mesh));
    player.group.position.set(0, 0, 8);
    player.velocity.set(0, 0, 0);
    player.health = 100;
    player.ammo = MAG_SIZE;
    player.reserve = RESERVE_MAX;
    player.reloading = false;
    player.fireCooldown = 0;
    player.alive = true;
    yaw = 0;
    pitch = 0.18;
    wave = 1;
    score = 0;
    kills = 0;
    remainingToSpawn = 0;
    waveClearDelay = 0;
    startWave();
    updateHud();
  }

  function updatePlayer(dt) {
    const speed = (keys.ShiftLeft || keys.ShiftRight ? 9.4 : 6.2);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let mx = 0;
    let mz = 0;
    if (keys.KeyW || keys.ArrowUp) mz -= 1;
    if (keys.KeyS || keys.ArrowDown) mz += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    const move = tmp.copy(forward).multiplyScalar(mz).add(tmp2.copy(right).multiplyScalar(mx));
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    moveWithCollision(player.group, move.x, move.z, PLAYER_RADIUS);

    if ((keys.Space || keys.Spacebar) && player.onGround) {
      player.velocity.y = 7.4;
      player.onGround = false;
    }
    player.velocity.y -= 22 * dt;
    player.group.position.y += player.velocity.y * dt;
    if (player.group.position.y <= 0) {
      player.group.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }

    const aim = aimPoint();
    const look = Math.atan2(aim.x - player.group.position.x, aim.z - player.group.position.z);
    player.group.rotation.y = look;

    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    if (player.reloading) {
      player.reloadTime -= dt;
      if (player.reloadTime <= 0) {
        const need = MAG_SIZE - player.ammo;
        const take = Math.min(need, player.reserve);
        player.ammo += take;
        player.reserve -= take;
        player.reloading = false;
        updateHud();
      }
    }
  }

  function updateCamera() {
    const dist = CAM_DIST;
    const camPos = tmp.set(
      player.group.position.x + Math.sin(yaw) * dist * Math.cos(pitch),
      player.group.position.y + 1.55 + Math.sin(pitch) * dist,
      player.group.position.z + Math.cos(yaw) * dist * Math.cos(pitch)
    );
    const origin = player.group.position.clone().add(new THREE.Vector3(0, 1.45, 0));
    const camDir = camPos.clone().sub(origin);
    const camDist = camDir.length();
    raycaster.set(origin, camDir.normalize());
    const blocks = raycaster.intersectObjects(
      obstacles.map((o) => o.mesh),
      false
    );
    if (blocks.length && blocks[0].distance < camDist - 0.35) {
      camPos.copy(origin).add(camDir.multiplyScalar(Math.max(1.2, blocks[0].distance - 0.4)));
    }
    if (shake > 0) {
      camPos.x += (Math.random() - 0.5) * shake;
      camPos.y += (Math.random() - 0.5) * shake;
    }
    camera.position.copy(camPos);
    lookTarget.copy(player.group.position).add(new THREE.Vector3(0, 1.35, 0));
    lookTarget.x -= Math.sin(yaw) * 4;
    lookTarget.y += Math.sin(pitch) * 3.2;
    lookTarget.z -= Math.cos(yaw) * 4;
    camera.lookAt(lookTarget);
  }

  function updateEnemies(dt) {
    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      const toPlayer = player.group.position.clone().sub(enemy.root.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      if (dist > 2.2) {
        toPlayer.normalize().multiplyScalar(enemy.speed * dt);
        moveWithCollision(enemy.root, toPlayer.x, toPlayer.z, enemy.radius);
      } else if (dist > 0.01) {
        hurtPlayer(14 * dt);
      }
      enemy.root.rotation.y = Math.atan2(
        player.group.position.x - enemy.root.position.x,
        player.group.position.z - enemy.root.position.z
      );
      enemy.fireCd -= dt;
      if (enemy.fireCd <= 0 && dist < 22 && dist > 2.4) {
        enemy.fireCd = Math.max(0.7, 1.6 - wave * 0.08);
        enemyShoot(enemy);
      }
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].alive) enemies.splice(i, 1);
    }

    if (remainingToSpawn > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy(randomSpawn());
        remainingToSpawn -= 1;
        spawnTimer = Math.max(0.35, 1.1 - wave * 0.06);
      }
    } else if (enemies.length === 0 && player.alive) {
      waveClearDelay += dt;
      if (waveClearDelay > 1.4) {
        wave += 1;
        score += 250;
        player.reserve = Math.min(RESERVE_MAX, player.reserve + 20);
        waveClearDelay = 0;
        startWave();
        updateHud();
      }
    }
  }

  function updateProjectiles(dt) {
    for (let i = enemyShots.length - 1; i >= 0; i--) {
      const s = enemyShots[i];
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      const p = s.mesh.position;
      const hitPlayer =
        player.alive &&
        Math.hypot(p.x - player.group.position.x, p.z - player.group.position.z) < 0.7 &&
        p.y > 0.4 &&
        p.y < PLAYER_HEIGHT + 0.4;
      const hitWall = collides(p.x, p.z, 0.12) || p.y < 0.1;
      if (hitPlayer) {
        hurtPlayer(12);
        scene.remove(s.mesh);
        enemyShots.splice(i, 1);
        continue;
      }
      if (hitWall || s.life <= 0) {
        spawnSpark(p, 0xff5533);
        scene.remove(s.mesh);
        enemyShots.splice(i, 1);
      }
    }

    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.7 + Math.sin(p.t * 3) * 0.12;
      if (p.mesh.position.distanceTo(player.group.position) < 1.3) {
        if (p.type === "hp") player.health = Math.min(100, player.health + 28);
        else player.reserve = Math.min(RESERVE_MAX, player.reserve + 30);
        scene.remove(p.mesh);
        pickups.splice(i, 1);
        updateHud();
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      sparks[i].life -= dt;
      if (sparks[i].life <= 0) {
        scene.remove(sparks[i].mesh);
        sparks[i].mesh.geometry?.dispose?.();
        sparks.splice(i, 1);
      }
    }
    shake = Math.max(0, shake - dt * 1.4);
    muzzleFlash = Math.max(0, muzzleFlash - dt);
  }

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.033, clock.getDelta());
    if (running && !paused && player.alive) {
      updatePlayer(dt);
      if (mouseDown) shoot();
      updateEnemies(dt);
      updateProjectiles(dt);
    }
    updateCamera();
    renderer.render(scene, camera);
  }

  function lockPointer() {
    canvas.requestPointerLock();
  }

  function startGame() {
    menu.hidden = true;
    gameoverEl.hidden = true;
    pauseEl.hidden = true;
    hud.hidden = false;
    running = true;
    paused = false;
    resetGame();
    lockPointer();
  }

  setupLights();
  buildArena();
  player.group = makeCharacter({
    body: 0x2c6f88,
    head: 0xd8c7b0,
    visor: 0x6ee7ff,
  });
  player.group.userData.kind = "player";
  player.group.traverse((n) => {
    n.userData.kind = "player";
    n.userData.owner = player.group;
  });
  player.group.position.set(0, 0, 8);
  scene.add(player.group);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "KeyR") startReload();
    if (e.code === "Escape" && running && player.alive) {
      paused = true;
      pauseEl.hidden = false;
      document.exitPointerLock();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });
  window.addEventListener("mousemove", (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.0016, -0.55, 0.85);
  });
  window.addEventListener("mousedown", (e) => {
    if (e.button === 0) mouseDown = true;
    if (e.button === 0 && running && !paused && pointerLocked) shoot();
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouseDown = false;
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked && running && player.alive && !paused) {
      paused = true;
      pauseEl.hidden = false;
    }
  });

  startBtn.addEventListener("click", startGame);
  resumeBtn.addEventListener("click", () => {
    paused = false;
    pauseEl.hidden = true;
    lockPointer();
  });
  retryBtn.addEventListener("click", startGame);
  canvas.addEventListener("click", () => {
    if (running && !paused && !pointerLocked) lockPointer();
  });

  updateCamera();
  tick();
})();
