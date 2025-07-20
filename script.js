// === Оновлений скрипт гри ===
// Режим з таймером, анімацією вибухів, звуком, руйнуванням об'єктів та обмеженням ППО

// --- Ініціалізація карти ---
const map = L.map('map').setView([49.0, 31.0], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

const droneFlyingSound = new Audio('assets/sounds/drone-flying.mp3'); // Перевірте розширення файлу (.mp3, .wav тощо)
droneFlyingSound.loop = true; // Шахед буде постійно дзижчати, поки не буде знищений
const explosionSound = new Audio('assets/sounds/explosion.mp3');
const hitSound = new Audio('assets/sounds/hit.mp3'); // Звук влучання по об'єкту
const missileLaunchSound = new Audio('assets/sounds/missile-launch.mp3'); // Звук запуску ракети (ППО)
const targetAcquiredSound = new Audio('assets/sounds/target-acquired.mp3'); // Звук захоплення цілі
const alarmSound = new Audio('assets/sounds/alarm.mp3'); // Звук тривоги для балістики/кинжала (припустимо, що alarm.mp3)
const fighterTakeoffSound = new Audio('assets/sounds/fighter-takeoff.mp3'); // Звук взльоту винищувача (припустимо, що fighter-takeoff.mp3)
const radioActive = new Audio('assets/sounds/radio_tu.mp3'); // звуктушок radio
const raketaSound = new Audio('assets/sounds/raketaSound.mp3');
const impactSound = new Audio('assets/sounds/прилёт.mp3'); // --- Звук прильоту по об'єкту ---



// --- Монети та UI ---
let coins = 10000;
let intercepted = 0; // Це вже є, але оновимо UI для нього

// --- ППО перезарядка ---
const pvoCooldowns = new Map();

// --- Специфікації ППО (базові значення) ---
const pvoSpecs = {
  mobile: { type: 'mobile', radius: 37000, cooldown: 800, max: 10, cost: 135, targetType: 'shahed' }, // Збільшено радіус мобільної групи в 3 рази
  gunner: { type: 'mobile', radius: 43000, cooldown: 500, max: 10, cost: 200, targetType: 'shahed' }, // Збільшено радіус кулеметника в 3 рази
  gepard: { type: 'mobile', radius: 58000, cooldown: 600, max: 11, cost: 650, targetType: 'shahed' }, // NEW: Gepard
  'drone-interceptor': { type: 'mobile', radius: 55000, cooldown: 1000, max: 3, cost: 900, targetType: 'shahed' }, // NEW: Drone Interceptor
  s100: { type: 'rocket', radius: 45000, cooldown: 1250, max: 4, cost: 400, targetType: 'missile' },
  patriot: { type: 'rocket', radius: 90000, cooldown: 1000, max: 3, cost: 2000, targetType: 'missile' },
  s300: { type: 'rocket', radius: 65000, cooldown: 750, max: 3, cost: 1000, targetType: 'missile' },
  thaad: { type: 'rocket', radius: 100000, cooldown: 500, max: 3, cost: 3000, targetType: 'missile' },
  // === UPDATED: Increased cooldown for SAMP/T and IRIS-T ===
  'samp-t': { type: 'rocket', radius: 80000, cooldown: 1500, max: 3, cost: 950, targetType: 'missile' }, // Increased from 900 to 1500
  'iris-t': { type: 'rocket', radius: 40000, cooldown: 1200, max: 4, cost: 888, targetType: 'missile' }, // Increased from 700 to 1200
  // === NEW: REB ===
  'reb': { type: 'reb', radius: 70000, cooldown: 0, max: 5, cost: 1250, targetType: 'shahed', isJammer: true }
};

// --- Рівні прокачки ППО (тепер для кожного типу окремо) ---
let upgradeLevels = {};
for (const type in pvoSpecs) {
    upgradeLevels[type] = { radius: 0, efficiency: 0 };
}

// --- Змінна для відстеження режиму покращення ---
let upgradeInProgress = null; // Зберігає 'radius' або 'efficiency'

function updateGameUI() {
  let coinEl = document.getElementById('coinDisplay');
  let interceptedEl = document.getElementById('interceptedDisplay');
  let waveEl = document.getElementById('waveDisplay');

  // Ensure elements exist before updating, as they are now in a separate div
  if (!coinEl) {
    console.error("coinDisplay element not found!");
    return;
  }
  if (!interceptedEl) {
    console.error("interceptedDisplay element not found!");
    return;
  }
  if (!waveEl) {
    console.error("waveDisplay element not found!");
    return;
  }

  coinEl.innerHTML = `Монети: <b>${coins}</b>`;
  interceptedEl.innerHTML = `Перехоплено: <b>${intercepted}</b>`;
  waveEl.innerHTML = `Хвиля: <b>${stats.wave}</b>`;
}

function rewardCoin(amount = 5) {
  coins += amount;
  updateGameUI();
}

// --- Функція для анімації польоту з обертанням та шумом ---
function flyWithRotation(marker, start, end, duration, onEnd) {
  let t = 0;
  const steps = duration / 20;
  const interval = setInterval(() => {
    t++;
    if (t >= steps) {
      clearInterval(interval);
      if (onEnd) onEnd();
      return;
    }
    const progressLinear = t / steps;
    const progress = progressLinear * progressLinear * (3 - 2 * progressLinear); // easeInOut
    const lat = start.lat + (end.lat - start.lat) * progress;
    const lng = start.lng + (end.lng - start.lng) * progress;
    const current = L.latLng(lat, lng);
    marker.setLatLng(current);

    const angle = Math.atan2(end.lat - lat, end.lng - lng) * 180 / Math.PI;
    const el = marker.getElement();
    if (el) {
      const img = el.querySelector('img');
      if (img) {
        img.style.transition = 'transform 0.1s linear';
        img.style.transform = `rotate(${angle + 90}deg)`;
      }
    }
  }, 20);
}

// --- Таймер до наступної хвилі ---
let countdown = 25; // Змінено на 25 секунд
const waveTimerEl = document.getElementById('waveTimerDisplay'); // Get by ID
function updateWaveTimer() {
  // Ensure element exists before updating
  if (!waveTimerEl) {
    console.error("waveTimerDisplay element not found!");
    return;
  }
  waveTimerEl.innerHTML = `Наступна хвиля через: <b>${countdown}</b> сек.`;
}
setInterval(() => {
  if (countdown > 0) {
    countdown--;
    updateWaveTimer();
  }
}, 1000);

// --- Кнопка ремонту ---
const repairBtn = document.getElementById('repairBtn'); // Get by ID
repairBtn.onclick = () => {
  targets.forEach(t => {
    // Тепер ремонт враховує maxHp кожного об'єкта
    if (t.hp < t.maxHp && coins >= 10) {
      t.hp = Math.min(t.maxHp, t.hp + 1); // Відновлюємо 1 HP, але не більше maxHp
      coins -= 10;
      updateGameUI();
      // Якщо об'єкт був знищений і відновив HP, знову додаємо його маркер
      if (t.destroyed && t.hp > 0) {
        t.destroyed = false;
        t.marker = L.marker([t.lat, t.lon]).addTo(map).bindPopup(`${t.name} (HP: ${t.hp}/${t.maxHp})`);
      } else if (t.marker && map.hasLayer(t.marker)) {
        t.marker.setPopupContent(`${t.name} (HP: ${t.hp}/${t.maxHp})`);
      }
    }
  });
};

let factories = [];

// Moved this interval outside of any click handlers to run once globally
setInterval(() => {
  factories.forEach(f => {
    if (!f.destroyed) {
      f.missileCount++;
      f.marker.setPopupContent(`🚀 Ракетний завод (HP: ${f.hp}/20, Ракет: ${f.missileCount})`);
    }
  });
}, 15 * 60 * 1000); // кожні 15 хвилин


const factoryBtn = document.getElementById('factoryBtn'); // Get by ID
factoryBtn.onclick = () => {
  if (factories.length >= 2) { // Fixed placement of this check
    alert("Максимум 2 заводи!");
    return;
  }
  if (coins < 50) {
    alert("Недостатньо монет");
    return;
  }

  coins -= 50;
  updateGameUI();
  map.once('click', (e) => {
    const marker = L.marker(e.latlng, {
      icon: L.divIcon({
        html: '<img src="https://i.ibb.co/wNwgkGXR/image.png" style="width:40px; height:40px;">',
        className: ''
      })
    }).addTo(map).bindPopup("Ракетний завод");

    const factoryTarget = {
      lat: e.latlng.lat,
      lon: e.latlng.lng,
      name: '🚀 Ракетний завод',
      destroyed: false,
      hp: 20,
      isFactory: true,
      marker
    };
    factories.push({
      ...factoryTarget,
      latlng: e.latlng,
      missileCount: 0
    });
    targets.push(factoryTarget);
  });
};

const ourMissiles = [
  { name: 'Важкий БпЛА', iconUrl: 'https://i.ibb.co/VcVzzbcH/image.png', size: [28, 28], anchor: [14, 14] },
  { name: 'БпЛА "Лютий"', iconUrl: 'https://i.ibb.co/DHc3MwJs/image.png', size: [35, 35], anchor: [17, 17] },
  { name: 'Крилата ракета "SCALP"', iconUrl: 'https://i.ibb.co/ksWjRm1G/image.png', size: [32, 32], anchor: [16, 16] }
];

const fireBtn = document.getElementById('fireBtn'); // Get by ID
fireBtn.onclick = () => {
  if (factories.length === 0) {
    alert("Немає заводів!");
    return;
  }

  // === ЗМІНА: Перевірка на монети для запуску ракети з заводу ===
  const MISSILE_COST = 850;
  if (coins < MISSILE_COST) {
    alert(`Недостатньо монет! Потрібно ${MISSILE_COST} монет для запуску ракети.`);
    return;
  }

  coins -= MISSILE_COST; // Знімаємо монети
  updateGameUI(); // Оновлюємо UI

  // Випадковий вибір ворожої цілі
  const targetData = enemyTargets[Math.floor(Math.random() * enemyTargets.length)];
  const target = L.latLng(targetData.lat, targetData.lon);

  // Випадковий вибір ракети з нашого арсеналу
  const selectedMissile = ourMissiles[Math.floor(Math.random() * ourMissiles.length)];

  alert(`🔥 Удар по: ${targetData.name} засобом "${selectedMissile.name}"!`);
  raketaSound.play(); // Відтворюємо звук запуску ракети

  const factory = factories[Math.floor(Math.random() * factories.length)];
  const start = factory.latlng;

  const missile = L.marker(start, {
    icon: L.icon({
      iconUrl: selectedMissile.iconUrl,
      iconSize: selectedMissile.size,
      iconAnchor: selectedMissile.anchor
    })
  }).addTo(map);

  let t = 0;
  const steps = 1000; // Тривалість польоту
  const interval = setInterval(() => {
    t++;
    if (t >= steps) {
      clearInterval(interval);
      map.removeLayer(missile);
      alert(`🔥 Засід ураження "${selectedMissile.name}" влучив по ворогу: ${targetData.name}!`);
      showExplosionAnimation(target);
      explosionSound.play(); // Додаємо звук вибуху при влучанні по ворогу
      return;
    }

    const lat = start.lat + (target.lat - start.lat) * (t / steps);
    const lng = start.lng + (target.lng - start.lng) * (t / steps);
    missile.setLatLng([lat, lng]);

    // Додаємо поворот ракети під час польоту (як для шахедів)
    const angle = Math.atan2(target.lat - lat, target.lng - lng) * 180 / Math.PI;
    const el = missile.getElement();
    if (el) {
      const img = el.querySelector('img');
      if (img) {
        img.style.transition = 'transform 0.1s linear';
        img.style.transform = `rotate(${angle + 90}deg)`;
      }
    }

  }, 10);
};

// --- Статистика та Game Over ---
let stats = { wave: 0, destroyed: 0, intercepted: 0 }; // intercepted вже є
function checkGameOver() {
  const alive = targets.filter(t => !t.destroyed && !t.isFactory); // Перевіряємо тільки не-заводи
  if (alive.length === 0) {
    alert(`Гру завершено\nЗнищено цілей: ${stats.destroyed}\nПерехоплено: ${stats.intercepted}`);
    location.reload();
  }
}


// --- Іконки ---

const icons = {
  kinzhal: L.icon({
    iconUrl: 'https://i.ibb.co/Qv4zg1w7/kinzhal.png',
    iconSize: [50, 50],
    iconAnchor: [15, 15]
  }),
  ballistic: L.icon({
    iconUrl: 'https://i.ibb.co/0yDDYgqq/3214231432443243244.png',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  }),
  patriot: L.icon({ iconUrl: 'https://i.ibb.co/pBnQSZhB/54675444754-3.png', iconSize: [50, 50], iconAnchor: [20, 20] }),
  mobile: L.icon({ iconUrl: 'https://i.ibb.co/qM0D0sf3/mobile.png', iconSize: [35, 35], iconAnchor: [17, 17] }),
  gunner: L.icon({ iconUrl: 'https://i.ibb.co/qM0D0sf3/mobile.png', iconSize: [30, 30], iconAnchor: [15, 15] }),
  s300: L.icon({ iconUrl: 'https://i.ibb.co/3mYKkP95/300.png', iconSize: [50, 50], iconAnchor: [19, 19] }),
  s100: L.icon({ iconUrl: 'https://i.ibb.co/C304d57H/s100.png', iconSize: [70, 35], iconAnchor: [35, 17] }),
  thaad: L.icon({ iconUrl: 'https://i.ibb.co/pjDKHZ27/thaad2.png', iconSize: [70, 45], iconAnchor: [35, 22] }),
  gepard: L.icon({ iconUrl: 'https://i.ibb.co/wrFNjq6f/gep.png', iconSize: [40, 40], iconAnchor: [20, 20] }), // NEW: Gepard Icon
  'drone-interceptor': L.icon({ iconUrl: 'https://i.ibb.co/LXvxrLX2/image.png', iconSize: [40, 40], iconAnchor: [20, 20] }), // NEW: Drone Interceptor Icon
  // === UPDATED: SAMP/T and IRIS-T Icons (no changes here, just for context) ===
  'samp-t': L.icon({ iconUrl: 'https://i.ibb.co/rRs2P8RJ/samp-shzhim.png', iconSize: [90, 45], iconAnchor: [45, 22] }), // Replace with actual SAMP/T icon
  'iris-t': L.icon({ iconUrl: 'https://i.ibb.co/bj38tZkX/iris.png', iconSize: [60, 30], iconAnchor: [30, 15] }), // Replace with actual IRIS-T icon
  // === NEW: REB Icon ===
  'reb': L.icon({ iconUrl: 'https://i.ibb.co/nqpCJxSs/image.png', iconSize: [60, 60], iconAnchor: [30, 30] }), // Replace with actual REB icon

  shahed: L.divIcon({
    html: '<img src="https://i.ibb.co/Ngvpr1KD/32-4.png" style="width:30px; height:30px; transform-origin: center;">', // Removed hardcoded initial rotation
    iconSize: [35, 35],
    className: ''
  }),
  fighter: L.divIcon({ // Нова іконка для винищувача (випадкова іконка літака)
    html: '<img src="https://i.ibb.co/LdfkVp3f/ty.png" style="width:50px; height:50px; transform-origin: center;">',
    iconSize: [50, 50],
    className: ''
  }),
  fighter_missile: L.icon({ // Іконка для ракет винищувача
    iconUrl: 'https://i.ibb.co/Tp2TVpB/image.png', // Можна використати ту ж, що й для X-101
    iconSize: [25, 25],
    iconAnchor: [12, 12]
  })
};

// --- Військові об'єкти ---
const enemyTargets = [
  { lat: 54.2149, lon: 34.3572, name: 'аеродром "Шайковка"' },
  { lat: 55.4245, lon: 42.3027, name: 'аеродром "Саваслейка"' },
  { lat: 51.4739, lon: 46.1930, name: 'аеродром "Енгельс-2"' },
  { lat: 48.9545, lon: 40.2954, name: 'аеродром "Міллєрово"' },
  { lat: 48.3079, lon: 46.2017, name: 'аеродром "Ахтубінськ"' },
];


const targets = [
  { lat: 50.345, lon: 30.890, name: 'Бориспільський аеропорт', type: 'military_airport', hp: 7, maxHp: 7, destroyed: false },
  { lat: 50.160, lon: 30.290, name: 'Військова частина "Васильків"', type: 'military_base', hp: 7, maxHp: 7, destroyed: false },
  { lat: 50.375, lon: 30.560, name: 'Київська ТЕЦ-5', type: 'power_plant', hp: 10, maxHp: 10, destroyed: false },
  { lat: 51.365, lon: 25.930, name: 'Рівненська АЕС', type: 'power_plant', hp: 12, maxHp: 12, destroyed: false },
  { lat: 49.444, lon: 32.060, name: 'Військова частина "Черкаси"', type: 'military_base', hp: 7, maxHp: 7, destroyed: false },
  { lat: 50.483, lon: 30.600, name: 'Генеральний штаб (Київ)', type: 'command_center', hp: 15, maxHp: 15, destroyed: false },
  { lat: 47.850, lon: 35.170, name: 'ДніпроГЕС (Запоріжжя)', type: 'critical_infra', hp: 10, maxHp: 10, destroyed: false },
  { lat: 48.625, lon: 22.300, name: 'Музей народної архітектури та побуту (Ужгород)', type: 'cultural', hp: 3, maxHp: 3, destroyed: false },
  { lat: 49.553, lon: 25.600, name: 'Тернопільський залізничний вузол', type: 'railway_hub', hp: 8, maxHp: 8, destroyed: false },
  { lat: 50.937, lon: 26.060, name: 'Склад палива (Рівне)', type: 'fuel_depot', hp: 6, maxHp: 6, destroyed: false },
  { lat: 46.47, lon: 30.73, name: 'Порт "Одеса"', type: 'port', hp: 10, maxHp: 10, destroyed: false, generatesBonus: true, bonusType: 'coins', bonusAmount: 25 }
];

// --- Маркери військових об'єктів ---
targets.forEach(t => {
  t.marker = L.marker([t.lat, t.lon]).addTo(map).bindPopup(`${t.name} (HP: ${t.hp}/${t.maxHp})`);
});

// --- Функція для бонусів від об'єктів (наприклад, Порт Одеси) ---
setInterval(() => {
  targets.forEach(t => {
    if (t.generatesBonus && !t.destroyed && t.bonusType === 'coins') {
      rewardCoin(t.bonusAmount);
      console.log(`Отримано ${t.bonusAmount} монет від ${t.name}!`);
    }
  });
}, 30000); // Кожні 30 секунд

// --- Після прибуття шахеда ---
function handleShahedHit(target) {
  target.hp--;
  showExplosionAnimation([target.lat, target.lon]); // Анімація вибуху при влучанні в ціль

  if (target.marker && map.hasLayer(target.marker)) {
    target.marker.setPopupContent(`${t.name} (HP: ${t.hp}/${t.maxHp})`);
  }

  if (target.hp <= 0 && !target.destroyed) {
    target.destroyed = true;
    map.removeLayer(target.marker);
    impactSound.play();
    stats.destroyed++;
    checkGameOver();
  }
}


// --- Кнопка старту ---

const startBtn = document.getElementById('startBtn'); // Get by ID
startBtn.onclick = () => {
  
  
  alert('⚠️ Початок хвилі атак!');
  let wave = 1;
  function nextWave() {
    stats.wave++;
    updateGameUI(); // Оновлюємо UI для відображення поточної хвилі

    if (stats.wave === 5) { // === НОВА ЗМІНА: Повідомлення на 5 хвилі ===
      showLaunchMessage("Активна бойова частота 4389 kHz. Існує ймовірність вильоту бомбардувальників.", true); // Pass true to show image
      radioActive.play();
    }

    spawnShahedWave(15 + stats.wave); // Змінено кількість шахедів назад на "трошки більше"
    // if (stats.wave % 2 === 0) spawnMissileWave('x101', 1); // Removed x101 missile spawn
    if (stats.wave % 3 === 0) spawnMissileWave('kinzhal', 3); // Запускаємо 3 "Кинжала"
    if (stats.wave % 4 === 0) spawnMissileWave('ballistic', 1);

    // Рандомний запуск винищувачів
    // Тепер авіація взлітає кожні 6 хвиль
    if (stats.wave > 0 && stats.wave % 6 === 0) {
      launchRandomFighters(4); // Запускаємо 3 винищувачі
    }

    setTimeout(nextWave, 25000); // Інтервал хвилі 25 секунд
  }
  nextWave();
};

// --- Функція для перевірки, чи точка знаходиться в межах полігону (України) ---
// Використовує алгоритм Ray Casting
function isInsidePolygon(point, polygon) {
  let x = point.lng, y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i][1], yi = polygon[i][0];
    let xj = polygon[j][1], yj = polygon[j][0];

    let intersect = ((yi > y) != (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Приблизні координати полігону, що представляє територію України
// Ці координати є спрощеними і не є точними кордонами
const ukrainePolygonCoords = [
  [52.3, 34.3], // Північний Схід
  [50.5, 40.2], // Схід (Донбас)
  [46.5, 37.0], // Південний Схід (Азовське море)
  [44.5, 33.5], // Крим (південний край)
  [45.3, 28.5], // Південний Захід (Одещина)
  [49.0, 22.0], // Захід (Львівщина)
  [51.7, 23.5], // Північний Захід (Волинь)
  [52.3, 34.3]  // Замикання полігону
];

function isInsideUkraine(latlng) {
  return isInsidePolygon(latlng, ukrainePolygonCoords);
}


// --- ППО ---
let placedPVO = [];
let totalPlacedPVO = 0; // Додано лічильник загальної кількості ППО
let selectedPVOType = null;
const pvoCount = { 
    patriot: 0, mobile: 0, gunner: 0, s300: 0, s100: 0, thaad: 0, gepard: 0, 'drone-interceptor': 0,
    // === NEW: pvoCount for new PVOs and REB ===
    'samp-t': 0, 'iris-t': 0, 'reb': 0
};


// Функція для застосування покращень до всіх розміщених ППО
function applyUpgradesToPVO() {
  placedPVO.forEach(pvo => {
    const originalSpec = pvoSpecs[pvo.type];
    const pvoUpgradeLevels = upgradeLevels[pvo.type]; // Отримуємо конкретні рівні покращення для цього типу ППО

    // Застосовуємо покращення радіусу
    pvo.currentRadius = originalSpec.radius * (1 + pvoUpgradeLevels.radius * 0.1); // 10% за кожен рівень
    if (pvo.circle) {
      pvo.circle.setRadius(pvo.currentRadius);
    }

    // Застосовуємо покращення ефективності (зменшуємо cooldown)
    // REB doesn't have a cooldown in the traditional sense, so skip this for REB
    if (pvo.type !== 'reb') {
      pvo.currentCooldown = originalSpec.cooldown * (1 - pvoUpgradeLevels.efficiency * 0.05); // 5% зменшення за кожен рівень
      if (pvo.currentCooldown < 50) pvo.currentCooldown = 50; // Мінімальний cooldown
    } else {
        pvo.currentCooldown = 0; // REB has no cooldown
    }


    // Оновлюємо властивості на об'єкті PVO для відображення в статистиці
    pvo.radiusLevel = pvoUpgradeLevels.radius;
    pvo.efficiencyLevel = pvoUpgradeLevels.efficiency;
  });
}

// --- Tooltip для статистики ППО ---
let pvoStatsTooltip = document.createElement('div');
pvoStatsTooltip.id = 'pvoStatsTooltip';
pvoStatsTooltip.style.position = 'absolute';
pvoStatsTooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
pvoStatsTooltip.style.color = 'white';
pvoStatsTooltip.style.padding = '8px';
pvoStatsTooltip.style.borderRadius = '5px';
pvoStatsTooltip.style.zIndex = '1000';
pvoStatsTooltip.style.display = 'none'; // Початково прихований
pvoStatsTooltip.style.pointerEvents = 'none'; // Щоб не блокував події миші під ним
document.body.appendChild(pvoStatsTooltip);

function showPVOStatsTooltip(e, pvo) {
    const pvoUpgradeLevels = upgradeLevels[pvo.type];
    let cooldownDisplay = pvo.type === 'reb' ? 'Немає' : `${(pvo.currentCooldown / 1000).toFixed(1)} сек (Рівень: ${pvoUpgradeLevels.efficiency})`;

    const tooltipContent = `
        <strong>${pvo.type.toUpperCase()}</strong><br>
        Радіус: ${Math.round(pvo.currentRadius / 1000)} км (Рівень: ${pvoUpgradeLevels.radius})<br>
        Перезарядка: ${cooldownDisplay}
    `;
    pvoStatsTooltip.innerHTML = tooltipContent;
    pvoStatsTooltip.style.left = (e.originalEvent.pageX + 10) + 'px';
    pvoStatsTooltip.style.top = (e.originalEvent.pageY + 10) + 'px';
    pvoStatsTooltip.style.display = 'block';
}

function hidePVOStatsTooltip() {
    pvoStatsTooltip.style.display = 'none';
}


document.querySelectorAll('.pvo-select-btn').forEach(btn => {
  const type = btn.dataset.type;
  const spec = pvoSpecs[type];
  // Update button text to show cost
  btn.innerHTML += ` (${spec.cost} монет)`;

  btn.addEventListener('click', () => {
    if (totalPlacedPVO >= 25) { // Перевірка на загальну кількість ППО
      alert("Не можна ставити більше 25 ППО!");
      return;
    }
    if (pvoCount[type] >= pvoSpecs[type].max) {
      alert(`Максимум ${pvoSpecs[type].max} одиниць ${type.toUpperCase()}`);
      return;
    }

    const pvoCost = pvoSpecs[type].cost;
    let isFreePlacement = false;

    if (coins < pvoCost) {
    alert(`Недостатньо монет! Потрібно ${pvoCost} монет.`);
    return;
  }


    selectedPVOType = type;
    map.once('click', (e) => {
      // ПЕРЕВІРКА НА ТЕРИТОРІЮ УКРАЇНИ
      if (!isInsideUkraine(e.latlng)) {
        alert("ППО можна розміщувати тільки на території України!");
        return; // Перериваємо розміщення ППО
      }

      coins -= pvoCost;
      updateGameUI();


      const spec = pvoSpecs[type];
      const pvoUpgradeLevels = upgradeLevels[type]; // Отримуємо поточні рівні покращення для цього типу

      // Розраховуємо початкові характеристики для нового ППО з урахуванням покращень
      const initialCurrentRadius = spec.radius * (1 + pvoUpgradeLevels.radius * 0.1);
      let initialCurrentCooldown = spec.cooldown * (1 - pvoUpgradeLevels.efficiency * 0.05);
      if (initialCurrentCooldown < 50) initialCurrentCooldown = 50; // Мінімальний cooldown

      const marker = L.marker(e.latlng, { icon: icons[type] }).addTo(map);
      const circle = L.circle(e.latlng, {
        radius: initialCurrentRadius, // Використовуємо розрахований радіус
        color: type === 'reb' ? 'purple' : 'blue', // REB has a different color circle
        fillOpacity: 0.1
      }).addTo(map);
      
      const newPvo = {
        type: type,
        category: spec.type,
        latlng: e.latlng,
        radius: spec.radius, // Оригінальний базовий радіус з pvoSpecs
        marker: marker,
        circle: circle,
        currentRadius: initialCurrentRadius, // Поточний радіус з урахуванням покращень
        currentCooldown: initialCurrentCooldown, // Поточний cooldown з урахуванням покращень
        radiusLevel: pvoUpgradeLevels.radius, // Додано для статистики
        efficiencyLevel: pvoUpgradeLevels.efficiency, // Додано для статистики
        isJammer: spec.isJammer || false // === NEW: isJammer property for REB ===
      };
      placedPVO.push(newPvo);
      pvoCount[type]++;
      totalPlacedPVO++; // Збільшуємо загальний лічильник ППО
      
      // Додаємо обробники подій миші для маркера
      marker.on('mouseover', (e) => showPVOStatsTooltip(e, newPvo));
      marker.on('mouseout', hidePVOStatsTooltip);
    });
  });
});

// Додаємо обробники подій для кнопок прокачки
document.querySelectorAll('.upgrade-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (placedPVO.length === 0) {
        alert("Спочатку розмістіть хоча б одну систему ППО, щоб її покращити.");
        return;
    }
    upgradeInProgress = btn.dataset.upgradeType; // 'radius' або 'efficiency'
    map.getContainer().style.cursor = 'crosshair'; // Змінюємо курсор
    alert(`Клікніть на розміщену ППО, яку хочете покращити (${upgradeInProgress === 'radius' ? 'радіус' : 'ефективність'})`);
  });
});

// Додаємо обробник кліку на карту для вибору ППО для покращення / продажу
map.on('click', (e) => {
  if (upgradeInProgress) {
    let upgraded = false;
    // Шукаємо, чи клікнули на якесь з розміщених ППО
    for (let i = placedPVO.length - 1; i >= 0; i--) {
      const pvo = placedPVO[i];
      // Перевіряємо, чи клік був достатньо близько до маркера ППО
      const distance = map.latLngToLayerPoint(e.latlng).distanceTo(map.latLngToLayerPoint(pvo.latlng));
      if (distance < 20) { // Порогова відстань для кліку на маркері
        const pvoType = pvo.type;
        const upgradeType = upgradeInProgress;
        let cost = 0;

        // ВАЖЛИВО: Максимальний рівень прокачки
        const MAX_UPGRADE_LEVEL = 3; // Задаємо максимальний рівень

        // REB units cannot be upgraded (initially)
        if (pvoType === 'reb') {
            alert('РЕБ не підлягає покращенню.');
            upgraded = true;
            break;
        }


        if (upgradeType === 'radius') {
          if (upgradeLevels[pvoType].radius >= MAX_UPGRADE_LEVEL) {
            alert(`Радіус ${pvoType.toUpperCase()} вже досяг максимального рівня (${MAX_UPGRADE_LEVEL}).`);
            upgraded = true;
            break;
          }
          cost = 50 + upgradeLevels[pvoType].radius * 25; // Зростаюча вартість
        } else if (upgradeType === 'efficiency') {
          if (upgradeLevels[pvoType].efficiency >= MAX_UPGRADE_LEVEL) {
            alert(`Ефективність ${pvoType.toUpperCase()} вже досягла максимального рівня (${MAX_UPGRADE_LEVEL}).`);
            upgraded = true;
            break;
          }
          cost = 75 + upgradeLevels[pvoType].efficiency * 50; // Зростаюча вартість
        }

        if (coins < cost) {
          alert(`Недостатньо монет для покращення ${pvoType.toUpperCase()}! Потрібно ${cost} монет.`);
          upgraded = true; // Позначаємо, що спроба була, щоб вийти з режиму покращення
          break;
        }

        if (upgradeType === 'radius') {
          upgradeLevels[pvoType].radius++;
          alert(`Радіус ${pvoType.toUpperCase()} збільшено! Поточний рівень: ${upgradeLevels[pvoType].radius}`);
        } else if (upgradeType === 'efficiency') {
          upgradeLevels[pvoType].efficiency++;
          alert(`Ефективність ${pvoType.toUpperCase()} збільшено! Поточний рівень: ${upgradeLevels[pvoType].efficiency}`);
        }
        coins -= cost;
        upgraded = true;
        break; // Виходимо з циклу після покращення одного ППО
      }
    }

    if (upgraded) {
      map.getContainer().style.cursor = ''; // Повертаємо курсор
      upgradeInProgress = null; // Скидаємо режим покращення
      updateGameUI(); // Оновлюємо відображення монет
      applyUpgradesToPVO(); // Застосовуємо нові покращення до всіх розміщених ППО
    } else {
        // Якщо клікнули не на ППО, але режим покращення активний
        alert("Будь ласка, клікніть на розміщену систему ППО.");
    }
  }
  // Логіка продажу ППО залишається тут, якщо upgradeInProgress неактивний
  else if (sellingPVO) {
    let sold = false;
    for (let i = placedPVO.length - 1; i >= 0; i--) {
      const pvo = placedPVO[i];
      const distance = map.latLngToLayerPoint(e.latlng).distanceTo(map.latLngToLayerPoint(pvo.latlng));
      if (distance < 20) {
        map.removeLayer(pvo.marker);
        map.removeLayer(pvo.circle);
        pvoCount[pvo.type]--;
        totalPlacedPVO--;
        const refundAmount = Math.floor(pvoSpecs[pvo.type].cost / 2);
        coins += refundAmount;
        updateGameUI();
        placedPVO.splice(i, 1);
        sold = true;
        break;
      }
    }
    if (sold) {
      sellingPVO = false;
      sellPVOBtn.style.backgroundColor = '';
      sellPVOBtn.innerText = "Продати ППО";
      map.getContainer().style.cursor = '';
    } else {
      alert("Немає ППО для продажу в цій точці.");
    }
  }
});


// --- Кнопка продажу ППО ---
let sellingPVO = false;
const sellPVOBtn = document.getElementById('sellPVOBtn'); // Get by ID
sellPVOBtn.onclick = () => {
  sellingPVO = !sellingPVO; // Перемикаємо режим продажу
  if (sellingPVO) {
    sellPVOBtn.style.backgroundColor = 'red';
    sellPVOBtn.innerText = "Клікніть на ППО для продажу";
    map.getContainer().style.cursor = 'crosshair'; // Змінюємо курсор
  } else {
    sellPVOBtn.style.backgroundColor = ''; // Повертаємо початковий колір
    sellPVOBtn.innerText = "Продати ППО";
    map.getContainer().style.cursor = ''; // Повертаємо курсор
  }
};


// --- AI ціль ---
function chooseSmartTarget() {
  const filtered = targets.filter(t => !t.destroyed);
  if (filtered.length === 0) {
    return null; // All targets destroyed
  }
  if (Math.random() < 0.5) {
    return filtered[Math.floor(Math.random() * filtered.length)];
  } else {
    return filtered.sort((a, b) => {
      const aPvo = placedPVO.filter(p => map.distance(p.latlng, [a.lat, a.lon]) < p.currentRadius).length; // Використовуємо currentRadius
      const bPvo = placedPVO.filter(p => map.distance(p.latlng, [b.lat, b.lon]) < b.currentRadius).length; // Використовуємо currentRadius
      return aPvo - bPvo;
    })[0];
  }
}

function showExplosionAnimation(latlng) {
  const explosion = L.divIcon({
    html: '<img src="https://i.gifer.com/2a9n.gif" style="width:50px; height:50px;">',
    className: ''
  });
  const marker = L.marker(latlng, { icon: explosion }).addTo(map);
  setTimeout(() => map.removeLayer(marker), 800);
}


// --- Елемент для повідомлень про запуск ---
const launchMessageEl = document.getElementById('launchMessage'); // Get by ID
const launchMessageTextEl = document.getElementById('launchMessageText'); // Get the paragraph for text
const radioImageEl = document.getElementById('radioImage'); // Get the image element

function showLaunchMessage(message, showImage = false) { // Added showImage parameter
  launchMessageTextEl.innerText = message;
  
  if (showImage) {
      radioImageEl.style.display = 'block'; // Show the image
  } else {
      radioImageEl.style.display = 'none'; // Hide the image
  }

  launchMessageEl.style.display = 'flex'; // Use flex for centering
  launchMessageEl.style.opacity = '1';

  setTimeout(() => {
    launchMessageEl.style.opacity = '0';
    setTimeout(() => {
      launchMessageEl.style.display = 'none';
      radioImageEl.style.display = 'none'; // Ensure image is hidden when message disappears
    }, 500); // Чекаємо завершення переходу, перш ніж приховати елемент
  }, 2500); // Показати протягом 1.5 секунди
}


// --- Спавн шахедів ---
function canFireFrom(pvo, cooldown) { // Приймаємо cooldown як параметр
  const now = Date.now();
  if (!pvoCooldowns.has(pvo)) return true;
  droneFlyingSound.play();
  return now - pvoCooldowns.get(pvo) >= cooldown;
}

function triggerPvoCooldown(pvo) {
  pvoCooldowns.set(pvo, Date.now());
}

function spawnShahedWave(count = 5) {
  countdown = 25; // Змінено на 25 секунд
  // Визначаємо дві точки для уявної лінії в Росії (наприклад, між табов та сочі путін хуйло)
  const lineStartPoint = L.latLng(53.7877,42.1436); // тамбов
  const lineEndPoint = L.latLng(43.5804,39.7925);   // сочі

  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      // Вибираємо випадкову точку на уявній лінії як старт шахеда
      const lineProgress = Math.random();
      const startLat = lineStartPoint.lat + (lineEndPoint.lat - lineStartPoint.lat) * lineProgress;
      const startLng = lineStartPoint.lng + (lineEndPoint.lng - lineEndPoint.lng) * lineProgress;
      const start = L.latLng(startLat, startLng);

      const target = chooseSmartTarget(); // Цілі залишаються українськими
      if (!target || target.destroyed) return;
      const end = L.latLng(target.lat, target.lon);

      const marker = L.marker(start, { icon: icons.shahed }).addTo(map);
      marker.hp = 3; // Шахед має 3 HP
      marker.target = target; // Зберігаємо об'єкт цілі для handleShahedHit

      // --- Початковий поворот шахеда при вильоті ---
      const initialAngle = Math.atan2(end.lat - start.lat, end.lng - start.lng) * 180 / Math.PI;
      const imgEl = marker.getElement()?.querySelector('img');
      if (imgEl) {
        imgEl.style.transformOrigin = 'center';
        imgEl.style.transform = `rotate(${initialAngle + 90}deg)`; // Set initial rotation to face target
      }
      // --- Кінець початкового повороту ---


      const indicator = L.circle(end, { radius: 20000, color: 'red', fillOpacity: 0.05 }).addTo(map);

      let t = 0;
      const baseSteps = 2000; // Base steps for shahed movement
      let currentSteps = baseSteps; // Will be modified by REB

      const interval = setInterval(() => {
        t++;

        // === NEW: REB jamming effect ===
        let rebFound = false;
        placedPVO.forEach(pvo => {
            if (pvo.type === 'reb' && map.distance(pvo.latlng, marker.getLatLng()) < pvo.currentRadius) {
                rebFound = true;
            }
        });

        if (rebFound) {
            currentSteps = baseSteps * 1.5; // Shahed slows down by 50%
        } else {
            currentSteps = baseSteps; // No REB, normal speed
        }
        // === END NEW: REB jamming effect ===


        if (t >= currentSteps) { // Use currentSteps here
          clearInterval(interval);
          if (map.hasLayer(marker)) {
            map.removeLayer(marker);
            map.removeLayer(indicator);
            handleShahedHit(target);
          }
          return;
        }

        const progress = t / currentSteps; // Use currentSteps for progress calculation
        // Рух строго по прямій лінії до цілі
        const lat = start.lat + (end.lat - start.lat) * progress;
        const lng = start.lng + (end.lng - start.lng) * progress;
        const currentPos = L.latLng(lat, lng);
        marker.setLatLng(currentPos);

        // Поворот зображення "шахеда"
        // This recalculates the angle based on current position and remaining target for smooth rotation
        const angle = Math.atan2(end.lat - currentPos.lat, end.lng - currentPos.lng) * 180 / Math.PI;
        const img = marker.getElement()?.querySelector('img');
        if (img) {
          img.style.transformOrigin = 'center';
          img.style.transform = `rotate(${angle + 90}deg)`;
        }

        // Слід
        if (t % 8 === 0 && currentPos) {
          const trail = L.circle(currentPos, {
            radius: 300,
            color: 'white',
            fillOpacity: 0.1,
            stroke: false
          }).addTo(map);
          setTimeout(() => map.removeLayer(trail), 3000);
        }

        // Зона ППО (Only Mobile Groups for Shaheds)
        if (currentPos) {
          placedPVO.forEach(pvo => {
            if (pvo.category === 'mobile' && map.distance(pvo.latlng, currentPos) < pvo.currentRadius && canFireFrom(pvo, pvo.currentCooldown)) { // Використовуємо currentRadius і currentCooldown
              triggerPvoCooldown(pvo);

              marker.hp--; // Зменшуємо HP шахеда
              hitSound.play();
              L.polyline([pvo.latlng, currentPos], {
                color: 'blue',
                weight: 3,
                dashArray: '4'
              }).addTo(map);

              setTimeout(() => map.eachLayer(layer => {
                if (layer instanceof L.Polyline && layer.options.color === 'blue') {
                  map.removeLayer(layer);
                }
              }), 300);

              if (marker.hp <= 0 && map.hasLayer(marker)) { // Шахед знищено
                showExplosionAnimation(currentPos);
                explosionSound.play();
                map.removeLayer(marker);
                map.removeLayer(indicator);
                rewardCoin(10);
                intercepted++; // Оновлюємо глобальний лічильник
                updateGameUI(); // Оновлюємо UI
                clearInterval(interval); // Зупиняємо політ шахеда

                // If the PVO that intercepted was a drone-interceptor, remove it.
                if (pvo.type === 'drone-interceptor') {
                  map.removeLayer(pvo.marker);
                  map.removeLayer(pvo.circle);
                  const index = placedPVO.indexOf(pvo);
                  if (index > -1) {
                    placedPVO.splice(index, 1);
                  }
                  pvoCount['drone-interceptor']--;
                  totalPlacedPVO--;
                }
              }
            }
          });
        }
      }, 20);
    }, i * 800);
  }
}


function spawnMissileWave(type = 'kinzhal', count = 3, startOverride = null, delayBetweenLaunches = 1000) { // Added delayBetweenLaunches parameter
  const configs = {
    kinzhal: {
      name: 'Кінжал',
      icon: icons.kinzhal,
      speed: 7,
      origin: () => L.latLng(53.26 + (Math.random() - 0.5) * 0.5, 40.42 + (Math.random() - 0.5) * 0.5) // === НОВА ЗМІНА: Кінжали тепер з Тамбова ===
    },
    ballistic: {
      name: 'Балістична',
      icon: icons.ballistic,
      speed: 4, // === ЗМІНА: Збільшена швидкість балістичної ракети ===
      origin: () => L.latLng(51.61 + (Math.random() - 0.5) * 0.5, 39.17 + (Math.random() - 0.5) * 0.5) // === ЗМІНА: Балістичні ракети тепер з Вороніжу ===
    },
    fighter_missile: { // Конфігурація для ракет винищувача
      name: 'Ракета винищувача',
      icon: icons.fighter_missile,
      speed: 1.5, // === ЗМІНА: Зменшена швидкість ракет з авіації ===
      // origin тут не потрібен, бо його завжди override'ить startOverride
    }
  };

  const config = configs[type];
  if (!config) { // Add a check in case an unknown missile type is passed
    console.error("Unknown missile type:", type);
    return;
  }

  // Показати повідомлення про запуск "Кинжала"
  if (type === 'kinzhal') {
    showLaunchMessage('Пуск аеробалістичної ракети Х47М2 "Кинжал"');
    alarmSound.play();
  }
  // Додайте цей блок для балістичних ракет
  if (type === 'ballistic') {
    showLaunchMessage('Загроза застосування балістичного озброєння');
    alarmSound.play();
  }


  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const start = startOverride ? startOverride : config.origin(); // Використовуємо startOverride, якщо він є
      const target = chooseSmartTarget();
      if (!target || target.destroyed) return;
      const end = L.latLng(target.lat, target.lon);

      const marker = L.marker(start, { icon: config.icon }).addTo(map);
      // Додаємо HP до ракет
      marker.hp = 2; // Ракета має 2 HP

      const indicator = L.circle(end, { radius: 20000, color: 'orange', fillOpacity: 0.05 }).addTo(map);

      let t = 0;
      const steps = 1800 / config.speed;
      const interval = setInterval(() => {
        t++;
        if (t >= steps) {
          clearInterval(interval);
          if (map.hasLayer(marker)) { // Перевіряємо, чи маркер ще існує
            map.removeLayer(marker);
            map.removeLayer(indicator);
            handleShahedHit(target);
          }
          return;
        }

        const progress = t / steps;
        const lat = start.lat + (end.lat - start.lat) * progress + 0.01 * Math.sin(t / 8 + i);
        const lng = start.lng + (end.lng - start.lng) * progress + 0.01 * Math.cos(t / 10 + i);
        const current = L.latLng(lat, lng);
        marker.setLatLng(current);

        // Поворот
        const angle = Math.atan2(end.lat - lat, end.lng - lng) * 180 / Math.PI;
        const img = marker.getElement()?.querySelector('img');
        if (img) img.style.transform = `rotate(${angle + 90}deg)`;

        // Слід
        if (t % 10 === 0) {
          const trail = L.circle(current, {
            radius: 400,
            color: 'orange',
            fillOpacity: 0.1,
            stroke: false
          }).addTo(map);
          setTimeout(() => map.removeLayer(trail), 4000);
        }

        // ППО (Only Rocket PVOs for Missiles)
        placedPVO.forEach(pvo => {
          if (pvo.category === 'rocket' && map.distance(pvo.latlng, current) < pvo.currentRadius && canFireFrom(pvo, pvo.currentCooldown)) { // Використовуємо currentRadius і currentCooldown
            triggerPvoCooldown(pvo);
            marker.hp--; // Зменшуємо HP ракети
            missileLaunchSound.play();
            L.polyline([pvo.latlng, current], {
              color: 'blue',
              weight: 3,
              dashArray: '4'
            }).addTo(map);


            setTimeout(() => map.eachLayer(layer => {
              if (layer instanceof L.Polyline && layer.options.color === 'blue') {
                map.removeLayer(layer);
              }
            }), 300);

            if (marker.hp <= 0 && map.hasLayer(marker)) { // Ракета знищена
              showExplosionAnimation(current);
              explosionSound.play()
              map.removeLayer(marker);
              map.removeLayer(indicator);
              rewardCoin(10);
              intercepted++; // Оновлюємо глобальний лічильник
              updateGameUI(); // Оновлюємо UI
              clearInterval(interval); // Зупиняємо політ ракети
            }
          }
        });

      }, 20);
    }, i * delayBetweenLaunches); // Інтервал запуску між ракетами
  }
}

// --- Фіксовані точки старту для винищувачів (Саратов) ---
const AerodromMasive = [
  L.latLng(51.53, 46.03), // saratov
  L.latLng(68.1225,33.4863) // оленья
];

// Точки прильоту для першої ноги винищувачів (Бєлгород та Ростов)
const fighterMidpointLocations = [
  L.latLng(48.0307,43.1102), // Волгодонське водосховище
  L.latLng(52.9986,43.2640),  // Пенза захід.
  L.latLng(46.3436,48.0980) // Астрахань
];


function launchRandomFighters(count = 3) {
  showLaunchMessage('Зліт стратегічної авіації. Виліт, ймовірно, бойовий.'); // Повідомлення про взліт авіації
  alarmSound.play();

  for (let i = 0; i < count; i++) {
    setTimeout(() => {

      const startAerodrom = [1, 2];
      const randomAerodrom = Math.floor(Math.random() * startAerodrom.length);

      const initialFighterPos = AerodromMasive[randomAerodrom]; // Corrected to use randomAerodrom as index


      // === ЗМІНА: Випадковий вибір з трьох точок ===
      // Створюємо масив з індексами тих точок, які хочемо використовувати
      const availableMidpoints = [0, 1, 2]; // Індекси для Саратова, Ростова, Воронежа
      // Випадково обираємо один індекс з цього масиву
      const randomIndex = Math.floor(Math.random() * availableMidpoints.length);
      const firstLegDestination = fighterMidpointLocations[availableMidpoints[randomIndex]];


      const fighterMarker = L.marker(initialFighterPos, { icon: icons.fighter }).addTo(map);
      fighterMarker.hp = 5; // Винищувач має 5 HP

      const flightDuration = 15000; // 10 секунд на політ до пусків зони
      const returnFlightDuration = 15000; // 8 секунд на зворотний політ
      let currentFlightStart = initialFighterPos;
      let currentFlightEnd = firstLegDestination;
      let currentDuration = flightDuration;
      let flyT = 0;
      let phase = 1; // 1 for outbound, 2 for return

      const fighterInterval = setInterval(() => {
        flyT++;
        const progress = flyT / (currentDuration / 20);

        const lat = currentFlightStart.lat + (currentFlightEnd.lat - currentFlightStart.lat) * progress;
        const lng = currentFlightStart.lng + (currentFlightEnd.lng - currentFlightStart.lng) * progress;
        const currentFighterPos = L.latLng(lat, lng);
        fighterMarker.setLatLng(currentFighterPos);

        // Обертання іконки винищувача
        const angle = Math.atan2(currentFlightEnd.lat - currentFighterPos.lat, currentFlightEnd.lng - currentFighterPos.lng) * 180 / Math.PI;
        const img = fighterMarker.getElement()?.querySelector('img');
        if (img) {
          img.style.transformOrigin = 'center';
          img.style.transform = `rotate(${angle + 90}deg)`;
        }

        if (flyT >= (currentDuration / 20)) {
          // If the fighter was destroyed by PVO, the interval would have been cleared.
          // So, if we reach here, it means the fighter completed its current leg of flight.
          if (map.hasLayer(fighterMarker)) { // If not destroyed by PVO during first leg
            if (phase === 1) { // First leg completed (flight to Rostov)
              clearInterval(fighterInterval); // Clear current interval
              showLaunchMessage(`Бомбардувальник №${i+1} випустив 5 ракет з ${currentFlightEnd.lat.toFixed(2)}, ${currentFlightEnd.lng.toFixed(2)}!`);
              spawnMissileWave('fighter_missile', 5, currentFlightEnd, 1500); // 5 ракет з позиції Ростова з інтервалом 2 секунди

              // Start return flight
              phase = 2;
              currentFlightStart = currentFlightEnd;
              currentFlightEnd = initialFighterPos;
              currentDuration = returnFlightDuration;
              flyT = 0; // Reset flyT for the new leg

              // Start a new interval for the return journey
              const returnInterval = setInterval(() => {
                  flyT++;
                  const returnProgress = flyT / (currentDuration / 20);
                  const returnLat = currentFlightStart.lat + (currentFlightEnd.lat - currentFlightStart.lat) * returnProgress;
                  const returnLng = currentFlightStart.lng + (currentFlightEnd.lng - currentFlightStart.lng) * returnProgress;
                  const returnPos = L.latLng(returnLat, returnLng);
                  fighterMarker.setLatLng(returnPos);

                  // Update rotation for return flight
                  const returnAngle = Math.atan2(currentFlightEnd.lat - returnPos.lat, currentFlightEnd.lng - returnPos.lng) * 180 / Math.PI;
                  const returnImg = fighterMarker.getElement()?.querySelector('img');
                  if (returnImg) {
                      returnImg.style.transformOrigin = 'center';
                      returnImg.style.transform = `rotate(${returnAngle + 90}deg)`;
                  }

                  // PVO interaction during return flight (similar to above)
                  if (returnPos) {
                      // Fighters can be intercepted by either mobile or rocket PVOs
                      placedPVO.forEach(pvo => {
                          if (map.distance(pvo.latlng, returnPos) < pvo.currentRadius && isInsideUkraine(returnPos) && canFireFrom(pvo, pvo.currentCooldown)) { // Використовуємо currentRadius і currentCooldown
                              triggerPvoCooldown(pvo);
                              fighterMarker.hp--;

                              L.polyline([pvo.latlng, returnPos], {
                                  color: 'purple',
                                  weight: 3,
                                  dashArray: '4'
                              }).addTo(map);

                              setTimeout(() => map.eachLayer(layer => {
                                  if (layer instanceof L.Polyline && layer.options.color === 'purple') {
                                      map.removeLayer(layer);
                                  }
                              }), 300);

                              if (fighterMarker.hp <= 0 && map.hasLayer(fighterMarker)) {
                                  clearInterval(returnInterval);
                                  map.removeLayer(fighterMarker);
                                  showExplosionAnimation(returnPos);
                                  rewardCoin(20);
                                  intercepted++;
                                  updateGameUI();
                                  return;
                              }
                          }
                      });
                  }

                  if (flyT >= (currentDuration / 20)) {
                      clearInterval(returnInterval);
                      if (map.hasLayer(fighterMarker)) { // Remove only if not destroyed by PVO
                          map.removeLayer(fighterMarker); // Remove fighter after it returns to Saratov
                      }
                  }
              }, 20); // Interval for return flight animation
            }
          }
        }
      }, 20);
    }, i * 3000); // === ЗМІНА: Запускаємо винищувачі з інтервалом 3 секунди ===
  }
}

// --- NEW: Collapsible PVO Section Logic ---
const pvoHeader = document.getElementById('pvoHeader');
const pvoContent = document.getElementById('pvoContent');

if (pvoHeader && pvoContent) {
  pvoHeader.addEventListener('click', () => {
    pvoContent.classList.toggle('collapsed');
    pvoHeader.classList.toggle('collapsed'); // Toggle class on header for arrow rotation

    // If it's collapsing, scroll to the top of the controls div.
    // This helps keep the important info at the top visible.
    if (pvoContent.classList.contains('collapsed')) {
        document.querySelector('.controls').scrollTop = 0;
    }
  });
}


updateGameUI(); // Оновлення UI при завантаженні
updateWaveTimer();
applyUpgradesToPVO(); // Застосувати покращення при завантаженні гри


// === ПАТЧ: оновлення цін та кольору ===

// === Оновлений скрипт гри ===


// --- Дозвіл на зміну кольору кола при максимальній прокачці ---
function unlockColorChangeUIFor(pvoType) {
  const controlsContainer = document.querySelector('.controls');
  if (!document.getElementById(`color-change-${pvoType}`)) {
    const btn = document.createElement('button');
    btn.innerText = `🎨 Змінити колір радіуса для ${pvoType.toUpperCase()}`;
    btn.className = 'action-button';
    btn.id = `color-change-${pvoType}`;
    btn.onclick = () => {
      const color = prompt('Введіть колір у форматі CSS (наприклад: red, blue, #00ff00):');
      if (!color) return;
      placedPVO.forEach(pvo => {
        if (pvo.type === pvoType && pvo.circle) {
          pvo.circle.setStyle({ color });
        }
      });
    };
    controlsContainer.appendChild(btn);
  }
}

// --- Оновлена applyUpgradesToPVO з підтримкою відкриття кольору ---
function applyUpgradesToPVO() {
  placedPVO.forEach(pvo => {
    const originalSpec = pvoSpecs[pvo.type];
    const pvoUpgradeLevels = upgradeLevels[pvo.type];

    pvo.currentRadius = originalSpec.radius * (1 + pvoUpgradeLevels.radius * 0.1);
    if (pvo.circle) {
      pvo.circle.setRadius(pvo.currentRadius);
    }

    if (pvo.type !== 'reb') {
      pvo.currentCooldown = originalSpec.cooldown * (1 - pvoUpgradeLevels.efficiency * 0.05);
      if (pvo.currentCooldown < 50) pvo.currentCooldown = 50;
    } else {
      pvo.currentCooldown = 0;
    }

    pvo.radiusLevel = pvoUpgradeLevels.radius;
    pvo.efficiencyLevel = pvoUpgradeLevels.efficiency;

    // --- Умова: при максимальній прокачці дати змінювати колір ---
    if (pvo.radiusLevel >= 3 && pvo.efficiencyLevel >= 3) {
      unlockColorChangeUIFor(pvo.type);
    }
  });
}
