# Tanki

Battle City ("Tank 1990", Dendy) inspired tank game, much prettier, with semi-realistic mechanics. Built together with the user (Latvian speaker: talk in Latvian; code and comments in English).

## Decisions so far
- Platform: browser game, three.js (3D, top-down/slanted camera). Multiplayer later via a small Node.js WebSocket server (Node is not installed yet). Friend joins with a link.
- Visual style: real 3D with metal PBR materials (see `dizains/stils_3d.png`, styles E–H). Earlier 2D style tests: `dizains/tanki_stili.png`.
- Models are built in Blender 5.2 (installed at `C:\Program Files\Blender Foundation\Blender 5.2`) by Python scripts run in background:
  `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python modeli/t44_build.py -- render [hero|rear|top|detail]`
  GPU: RTX 3050 Ti (OptiX). The script regenerates `modeli/t44.blend`; manual edits in that file are overwritten.
- Mechanics: semi-realistic (armour, reload, ammo types). Reloads fairly long; some tanks may have a burst (e.g. 3 quick shots, then a long reload).

## T-44 model (`modeli/t44_build.py`)
- Units meters, tank faces -Y, left side = +X. Dimensions from the user's blueprints in `Bildes/` (hull 6.07 x 3.18 m, turret ~2.85 x 2.06 m, 5 spoked road wheels, rear sprocket, front idler, commander cupola rear right per both drawings).
- Materials are procedural Cycles node trees (edge wear via Bevel-node normal difference, AO grime, dust by height, streaks). For the game they must be baked to textures and exported as .glb.
- Grab rails and roof items are placed by ray-casting onto the evaluated turret/hull surface (`surface()`, `rail()`, `roof()`), so nothing floats.
- v1 backup: `modeli/t44_build_v1.py`.

## Game (first test, 2026-10-06)
- Run: `python serve.py` (port 8090, correct JS MIME types + no-cache; plain `http.server` serves .js as text/plain on Windows) → http://localhost:8090. Preview config `.claude/launch.json` ("tanki").
- `web/js`: `main.js` (Game: renderer, bloom, camera, input, spawns, respawn/end logic, timers on game time via `later()`, `simulate(sec)` test helper that works in a hidden tab), `map.js` (layout authored in 2 m tiles 48x36, mirrored 180°; simulated in 1 m cells 96x72; instanced bricks/steel/rubble/trees, water, eagle bases), `tank.js` (movement, sample-point collision, pushing tanks/wrecks, turret traverse, hit proxies hull/turret boxes, armour), `combat.js` (shells in 0.4 m steps vs tanks/walls/ground/water, HE splash), `fx.js` (sprite particles, debris, track marks, scorch, flash lights), `ai.js` (A* on 2 m tiles with 4x4 m clearance, attack/defend roles, shoots bricks in the way, unstick), `hud.js`, `audio.js` (synthesized WebAudio), `config.js` (balance).
- Model: `modeli/t44_export.py` bakes the procedural materials (color, roughness+metal, normal) into atlases and exports `web/assets/t44.glb` (~96k tris, 10 MB). Nodes: hull, track, turret (pivot at ring), gun (pivot at mantlet). Model faces +Z in three.js.
- Running gear (v2 export): every road wheel/idler/sprocket is its own node (`wheel_L0..4`, `idler_L`, `sprocket_L`, …) with the pivot on the axle; the static tracks were replaced by `link` (two 0.14 m links). `tank.js` rebuilds the track path from the Blender constants and instances 50 link pairs per side, sliding them by each side's speed (v ∓ ω·1.34); wheels spin by distance / radius.
- Turret numbers are not in the GLB (baked thin text came out dark); `tank.js` adds canvas-texture decals on both turret sides, one number per tank (blue 1xx, red 2xx).
- Modules (`config.MODULES`): a penetration may jam the turret, break a track (low side hull hits) or damage the engine (mostly rear hits). `tank.mod[k]`: 0 ok, -1 broken, > 0 repair seconds left. Broken stays broken until repair (F for the player, bots repair at once); repair times turret 9 s, track 6 s, engine 9 s, in parallel.
- Hit decals: `tank.addDecal()` ray-casts the real meshes and projects a `DecalGeometry` (hole for penetrations, bright gouge otherwise), max 24 per tank, kept on wrecks. Shared decal materials are skipped when a wreck is darkened (`userData.hitDecal`).
- Camera modes (`opts.camMode`, V toggles): `tactical` (cursor aims, right-drag or hold C orbits, wheel 9–95 m) and `wt` (pointer lock, mouse turns the view, turret follows the screen centre, wheel 7–34 m). Shift = gunner's sight (FOV 4–24°, Soviet-style reticle overlay `#scope`, own tank hidden). Hold C = free look in every mode (aim frozen, view snaps back on release). X resets the camera. Losing pointer lock (Esc) pauses. Aim rays use `world.raycast()` (walls/ground) plus the tank proxies; in `wt` the ray starts past the tank so walls behind the camera are ignored.
- Broken track: no driving, pivot turning at 60%, the broken side's links stop (`trackSide`). Dead engine: no movement at all, heavy black smoke with flames, repair 12 s.
- `game.separate()` eases overlapping tanks apart each frame (wrecks move less), never into walls.
- Blocked by a wall: the tank turns if it can and slides along the wall with the x or z part of its motion (walls are grid-aligned); if nothing fits and throttle is held, `spinning` keeps the tracks running with dust.
- Water is fordable: slowdown and sinking scale with the share of footprint samples in water (`wetF`: speed ×(1−0.67·wetF), sink 0.45·wetF), so the tank does not sink on the bank; the tank sinks up to 0.45 m (`sink`, also applied to the hit proxies), wake splashes; A* allows water at extra cost.
- Water tilt: sink is computed separately for front/rear and left/right halves of the footprint; the hull pitches/rolls (`rotation` order 'YXZ') so a tank entering the river noses in instead of sinking into the bank.
- Match stats (`game.stats` by tank name, survive respawns): kills, deaths, damage, shots, penetrations. Hold Tab for the scoreboard (`#board`), also shown on the end screen. Killing an enemy shows the `#banner` "IZNĪCINĀTS · name" with a chime; hit/module messages are skipped for the killing shot. Option `rings` hides the team rings.
- Out of reserves: `#dead` panel with "Novērot kauju" (Space cycles allied tanks via `spectateNext()`) and "Sākt no jauna"; the pause menu also has "Sākt no jauna".
- Crosshair colour follows the penetration hint (`#cross[data-pen=yes|maybe|no]`). Bots pick turret/hull aim height once per target scan (choosing it per frame made barrels jump).
- Performance: the renderer asks for `powerPreference: 'high-performance'`; F3 shows FPS and the GPU name. On this laptop Chrome ran WebGL on the Intel UHD iGPU (≈27 FPS) unless Windows graphics settings set the browser to the NVIDIA GPU.
- Walls: bricks 2.5 m, steel 2.6 m (taller than the 2.2 m turret) so tanks can hide.
- Option "carReverse" (default on) inverts A/D while reversing like War Thunder. Options persist in localStorage `tanki.opts`.
- Graphics options (pause menu, `applyQuality()`): quality high/medium/low (pixel ratio, shadow map 2048/1024/off, bloom) and a frame cap 60/30/none (default medium + 60). F3 shows FPS. Reason: on 2026-10-06 the laptop powered off unexpectedly (Windows event 6008, no crash record) while Blender was baking and the game was rendering; likely thermal/power protection. Don't run Blender bakes and game tests at the same time.
- Claude tests on port 8091 (`tanki-test` in launch.json) so the user's `start.bat` server on 8090 keeps running.
- InstancedMeshes that change at runtime (track marks, scorches, debris, rubble, links) need `frustumCulled = false`, otherwise they vanish depending on the camera.
- Hit zones (`spec.hullParts` + turret): upper hull/glacis (front 240), lower front plate (160), left/right track boxes (`region: 'track'`: 12–25% damage, 75% chance to break that track, no armour check). Faces include `bottom`. Messages and the crosshair hint name the zone (`part.label`).
- Eagle: only the golden eagle box (x ±1.15, y 1.6–3.1, z ±0.6 around the base centre) takes hits (`combat.eagle()`); the BASE cells are a 1.5 m concrete plinth that just stops shells. Bots aim at y 2.2.
- Water tilt divisors: pitch = atan2(sinkF − sinkR, 6.2), roll over 3.2 (half-centre spacing ×2), so the end on the bank stays at ground level.
- Foliage within 4.5 m of the camera is discarded and dithered out to 8 m (WT camera passing through tree crowns).
- Feedback: `#hitmark` (green = penetration/track, yellow = bounce) at the crosshair, `#dmgdirs` red arcs pointing to whoever hit the player. Holding bots angle the hull ±25° to the enemy.
- Armour: hit proxies are boxes; face from the slab-test entry axis, effective = base / cos. AP ricochets below cos .34. Penetration hint at the crosshair (`penHint`).
- Testing in the Browser pane: it is often hidden (requestAnimationFrame stops), so use `game.simulate(seconds)` and `game.watch = tank` for the camera; keep JS calls under ~40 s. After editing JS, refetch with `fetch(url, {cache:'reload'})` before reloading.

## Next session: start here (updated 2026-10-06)
The previous session ended because its context was full. Everything above is current. The user tests at http://localhost:8090 (`start.bat`) and sends screenshots plus numbered wish lists in Latvian; work through them, test on 8091 with `game.simulate()`, then summarise in Latvian.

Done on 2026-10-06 (second session):
- Water edges: `World.waterField()` gives a signed distance (m) to the water cells; `shore()` adds fbm noise so the shore is irregular. `mudTexture()` paints a 1.7–3.5 m band of wet mud (ruts across the fords and along the banks, soft puddles) onto the ground texture and builds `groundRough` (roughness map: wet mud glossy). The water is one plane over the river's bounding box with a baked RGBA map (shallow brown edge → dark teal, broken foam line, alpha fades at the edge), roughness .3, envMapIntensity .3. Physics still uses the 1 m water cells.
- Trees inside the map replaced by bushes (`C.BUSH`, tile 'T'): ~190 interactive bushes (`world.bush`, one InstancedMesh, `aBend` instance attribute: lean + flatten in the vertex shader, wind sway, same deform in `customDepthMaterial` so shadows follow). `updateBushes(dt)` (called from `Game.update`) bends bushes out of the hull and along the motion while a tank overlaps them, then springs back. Each entry at > 0.8 m/s is a pass; passes flatten progressively, after `need` (3–5) passes the bush stays down as a dark grass patch and stops hiding tanks. Concealment = `world.cover` (count of standing bushes per 1 m cell), `concealed(x,z)`; `sight()` hides a concealed target beyond 18 m. Leaves (green sprites) + `sfx.rustle()` on a pass.
- Bushes also fill the first ~10 m outside the map; trees remain only further out (scenery). `foliage()` holds the shared shader (bend + see-through dither around the watched tank and in front of the camera).
- `world.raycast()` ground hit now needs d.y < 0 (a camera never rendered sits at y 0 and gave NaN aim).

Done later on 2026-10-06 (third request):
- Damage arcs `#dmgdirs .dmgdir` are coloured by the result: red `pen`, yellow `track`, blue otherwise (armour held / ricochet).
- Loading screen `#loader` with `web/assets/loading.jpg` (Blender render by `modeli/loading_render.py`: T-44 in evening light, brick wall, bushes, smoke column, haze box; `-- preview` renders a small test to `modeli/renders/loading_preview.jpg`, ~15 s; the full 1920x1080 render ~1 min) and a progress bar.
- Main menu `#menu` (same picture): team size 1v1 / 3v3, rules `lives3` (each player 3 lives = 2 respawns) / `lives1` / `time` (2, 3, 5 min, unlimited respawns, respawn 5 s). Last choice saved in `opts.mode`. Tabs: settings (the single `#opts` block is moved between the menu and the pause card) and controls/tips. "Spēlēt ar draugu" is a disabled placeholder.
- `game.newMatch(mode)` = `teardown()` (removes and disposes everything in the scene except objects with `userData.keep`: hemisphere light, sun, sun target) + `setup(mode)`; no page reloads any more. `toMenu()` goes back. Pause card: Turpināt / Sākt no jauna / Galvenā izvēlne + options; end and dead panels also have "Galvenā izvēlne"; R restarts after the end.
- Per-player respawns `game.left[team][slot]`; a team loses when nobody is alive, no respawns are left and none are pending; the eagle still ends the game in every mode. Timed: `timeLeft` counts down in `update()`, `timeUp()` compares team kills, then eagle HP, else "Neizšķirts". HUD: `#timer`, `#blueinfo/#redinfo` (kills in timed mode, reserve otherwise), own lives `#mylives` (●○).
- Testing: `game.newMatch({size: 1, rule: 'time', minutes: 2})` starts a match straight from JS.

Done (fourth request, 2026-10-06):
- Loading/menu picture `web/assets/loading.jpg` is now the user's ChatGPT image (sunset T-44) with the baked "LOADING..." text and bar removed by a numpy Laplace fill + borrowed detail. The Blender render is kept as `modeli/renders/loading_blender.jpg` (loading_render.py now writes there).
- Gun mantlet zone: `spec.turretParts` (turret space, checked after the turret box, wins ties): front 320 mm (AP 150 cannot pen), side 110, measured from the model (x ±0.45, y .04–.6, z 1.35–1.92).
- Sound (`audio.js`): V-12 diesel synth (periodic-wave firing pulses at rpm/10 Hz, half-order triangle, noise clatter chopped at the firing rate, tanh shaper, load-driven low-pass; rpm with inertia), track noise (grind + skid squeal from `tank.trackV`/`turnW`) and link knocks scheduled on the audio clock (`sfx.tracks(tank, trackV, vol)`, 3 pre-made clack buffers) for the player and nearby tanks.
- Node.js v24.19.0 LTS + npm 11.17 installed 2026-10-06 via winget (`C:/Program Files/nodejs`; open a new shell if `node` is not on PATH yet).
- Audio is suspended while the tab is hidden (a hidden test tab once kept the idle engine humming). After browser tests, close the Browser pane tab or call `game.sfx.ctx.close()`.

Online play (built 2026-10-06, tested locally with two browser tabs):
- `server/server.js` (Node, dependency `ws`): serves `web/` and WebSocket `/ws` rooms (name, optional password, max 6 players, 3 per team, settings rule/minutes/bots per team, state lobby|game). Messages: name, list, create, join, leave, team, settings, start, lobby, g (game relay: host -> all guests, guest -> host with `from`). Host leaving closes the room. Run `start_online.bat` (port 8095); Claude tests on 8096 (`tanki-net-test` in launch.json, two Browser-pane tabs).
- Host-authoritative: the room creator's browser runs the normal game; `web/js/net.js` (`Net`, kept as `game.online`; `game.net` is set only during an online match) sends 20 Hz snapshots (`tank.netState()`: position, heading, v, turret, pitch, hp, reload, ammo, shield, spin, modules) plus events in host order: spawn, shot, hit, kill, bricks, base, end; stats once a second. Guests' tanks are puppets (`tank.puppetUpdate()` glides to the snapshot and runs `visuals()`), their shells are visual only (`combat.spawn(..., visual = true)`, removed by the host's hit event), they send inputs 20 Hz (throttle, turn, aim point, fire, ammo, repair counter).
- Guest code paths skip AI, lives, respawns and the end logic (`onKill` returns after the presentation part). A guest who leaves mid-match: the host gives the tank to a bot (`playerLeft`). Messages/end title are relative to `game.myTeam`.
- Online matches never pause (Esc only shows the menu, the tank stops). A worker timer keeps `update()` running when animation frames stall (hidden/minimised/covered window), so the host never freezes the battle.
- Cloud: Render workspace "Jānis's workspace" (tea-dauj7u3ncjis73frkb4g) is connected; a Render web service needs a Git repo (build `cd server && npm install`, start `node server/server.js`, PORT from env, region frankfurt). git 2.36 is installed, gh is not. Not deployed yet.

Next ideas (ask the user): online rooms with a friend (password, same or opposite team, bots per team; needs Node.js), Tiger I model in Blender (same pipeline as the T-44: `modeli/t44_build.py` → `t44_export.py`; the user explicitly allowed Blender work), tank selection, an artillery vehicle, later online play. Maybe: lower riverbed, bots preferring/avoiding bushes, decide whether the outer trees stay.

Working rules learned so far:
- Speak Latvian with the user; code and comments in English. The user approves each git commit (the folder is not a git repo yet).
- The laptop (RTX 3050 Ti) has powered off twice under heavy GPU load (Blender bake + game, and the game at 144 FPS uncapped). Never run Blender bakes and browser tests at the same time; recommend the 60 FPS cap. The cap now uses a running deadline so it reaches 60 on a 144 Hz screen (it used to give 48).
- Chrome must run on the NVIDIA GPU (Windows Settings → Display → Graphics → Chrome → High performance); F3 shows the GPU name.
- Patch larger edits through small Python scripts in the scratchpad (bash heredocs mangle quotes); `assert` that each search string exists.

## Plan
1. Test build: one tank (T-44), one test map with brick walls and an eagle/HQ to defend, solo vs bots (then bot teammates, 3v3 → 5v5).
2. Later tank choice: T-44, Tiger I, an artillery vehicle.
3. Later: online play with a friend (co-op vs bots and PvP).
