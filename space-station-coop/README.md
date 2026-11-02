# DEAD ORBIT — co-op salvage horror (browser)

A "friend-slop" style co-op game that runs in the browser: scavenge a derelict space station with friends,
haul salvage back to the dropship pad, hit the quota — while something hunts you by **sound and light**.

## Run it

```bash
cd space-station-coop
npm install
npm start            # http://localhost:3000
```

Open the page, pick a callsign and a **station code**. Anyone who enters the same code joins your game
(up to 8 players). The first player is the host; if they leave, host migrates automatically.

### Playing with friends over the internet
Your friends need to reach your server. Easiest: run a tunnel (HTTPS is also required for the microphone
on anything that isn't `localhost`):

```bash
npx cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```
Send them the `https://…` URL and the station code. Or deploy `server/server.js` to any Node host (Render, Fly, Railway…).

## Controls
| Key | Action |
|---|---|
| WASD | move · SHIFT sprint (uses stamina) · SPACE jump |
| E | grab loot · LMB throw · Q drop |
| F | flashlight (battery drains, recharges when off) |
| V | mute / unmute microphone |

## How it plays
- **Proximity voice chat** (WebRTC, 3D-positioned — use headphones). Your mic is also *noise* the monster can hear.
- **The Stalker** hunts by sound: sprinting, jumping, thrown junk, loud voices. It sees you from farther away if your flashlight is on.
  Hit it with a thrown item to stun it for ~2s.
- Loot has different value and weight (heavy cores slow you down). The rubber duck squeaks. Bank loot by leaving it on the glowing pad.
- Hit the quota to start the next round (more quota, more monsters). If the whole crew dies the run resets.
- Dead players become free-flying ghosts.

## Under the hood
- `client/` — Three.js (r170) game, all assets procedural (textures drawn on canvas, sound synthesised with WebAudio, no asset files).
  - `level.js` procedural station (seeded maze of rooms, sliding doors, props, flickering lights, dynamic light pool)
  - `monster.js` host-side AI (hearing/sight/pathfinding) + visual with **procedural IK legs** and tripod gait
  - `remote.js` teammate avatars (procedural walk cycle, ragdoll-style topple)
  - `audio.js` HRTF-spatialised synth SFX, convolution reverb, adaptive tension layer + heartbeat, spatial voice
  - `voice.js` WebRTC mesh signalled through the game server
  - `fx.js` post-processing (bloom, chromatic aberration, grain, vignette, damage/fear grading), particles, dust
- `server/server.js` — static file server + tiny WebSocket relay (rooms, host election, signalling). The host client is authoritative for loot, monsters and round flow.

Add `?q=low` to the URL for a low-res render mode, `?nobloom` to drop bloom.
