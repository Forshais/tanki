// Game balance. Armour values are effective thickness (mm) for a shot hitting the face head-on;
// slope of the T-44 glacis (120 mm at 60 deg) is folded into hull.front.
export const TEAMS = {
  blue: { name: 'Zilie', color: '#5aa9ff' },
  red: { name: 'Sarkanie', color: '#ff6a5a' },
};

export const SHELLS = {
  AP: { label: 'BB', name: 'Bruņu caursitošais', pen: 150, dmg: [230, 330], speed: 160, brickR: 0.9, splash: 0 },
  HE: { label: 'OF', name: 'Fugasais', pen: 45, dmg: [300, 400], speed: 140, brickR: 1.7, splash: 3.2, splashDmg: [40, 90] },
};

export const TANKS = {
  T44: {
    name: 'T-44',
    model: 'assets/t44.glb',
    hp: 1000,
    maxSpeed: 8, reverse: 3.5, accel: 5, brake: 12,
    turnRate: 1.0,          // rad/s
    turretRate: 0.75,       // rad/s
    reload: 6.0,            // s
    ammo: ['AP', 'HE'],
    armor: {
      hull: { front: 240, side: 75, rear: 45, top: 20 },
      turret: { front: 160, side: 90, rear: 75, top: 20 },
    },
    // collision box in model space (model faces +Z)
    hull: { hw: 1.63, hl: 3.15, h: 1.46 },
    // hit zones: upper hull with the glacis, lower front plate, and the two tracks (spaced: they eat the shell)
    hullParts: [
      { region: 'hull', label: 'korpusā', min: [-1.21, 1.03, -3.0], max: [1.21, 1.46, 3.0], armor: { front: 240, side: 75, rear: 45, top: 20, bottom: 20 } },
      { region: 'lower', label: 'apakšējā plāksnē', min: [-1.05, .43, -2.9], max: [1.05, 1.03, 3.03], armor: { front: 160, side: 75, rear: 45, top: 20, bottom: 20 } },
      { region: 'track', label: 'ķēdē', side: 'L', min: [1.07, 0, -3.25], max: [1.63, 1.05, 3.25] },
      { region: 'track', label: 'ķēdē', side: 'R', min: [-1.63, 0, -3.25], max: [-1.07, 1.05, 3.25] },
    ],
    turret: { pivot: [0, 1.46, 0.05], hw: 1.0, front: 1.53, rear: 1.31, h: 0.72 },
    // extra turret zones in turret space (checked before the turret box): the gun mantlet is thick cast steel,
    // practically immune from the front; its narrow sides can be penetrated by a shot from straight to the side
    turretParts: [
      { region: 'turret', label: 'stobra maskā', min: [-.45, .04, 1.35], max: [.45, .6, 1.92], armor: { front: 320, side: 110, rear: 90, top: 70, bottom: 70 } },
    ],
    gunPivot: [0, 0.35, 1.55],   // in turret space
    muzzle: 2.95,                // along gun +Z
    depression: -0.10, elevation: 0.12,
  },
};

// a damaged module stays broken until the crew repairs it (F); repair times in seconds
export const MODULES = {
  turret: { repair: 9, name: 'Tornis iestrēdzis', icon: 'T', done: 'Tornis salabots' },
  track: { repair: 6, name: 'Ķēde sarauta', icon: 'Ķ', done: 'Ķēde salabota' },
  engine: { repair: 12, name: 'Dzinējs bojāts', icon: 'D', done: 'Dzinējs salabots' },
};

export const GAME = {
  respawn: 8,        // s (lives modes)
  respawnTimed: 5,   // s (timed mode, unlimited respawns)
  baseHp: 4,
  wreckLife: 30,     // s a wreck stays as an obstacle
};
