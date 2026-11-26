# ECHO

A first-person horror game for the web browser. You are trapped in total darkness
in an abandoned salt mine. The only way to see is to make a sound: every clap sends
out an echolocation pulse that briefly outlines the world in glowing lines.
A blind creature, the Listener, hunts by sound. Every clap shows you the way,
and it also tells the creature where you are.

## How to run

You need Python 3 (for a tiny local web server) and an internet connection
(Three.js is loaded from a CDN).

```bash
cd Game-Project-Claude
python3 -m http.server
```

Then open **http://localhost:8000** in Chrome, Edge or Firefox. Headphones are recommended.

## Controls

| Key | Action |
| --- | --- |
| WASD | move |
| Mouse | look around (click to capture the mouse) |
| Shift | run: faster, but louder |
| C | creep: slow and silent |
| Space / left click | **clap**: big pulse (~18 m), loud, 1.2 s cooldown |
| Q / right click | **snap**: small quiet pulse (~5 m) |
| E | throw a pebble (makes noise where it lands, as a distraction) |
| Esc | pause |

**Goal:** find the 4 humming tuning forks (follow their gold ripples and hum),
then reach the old elevator at the far end of the mine.

## Files

| File | What it does |
| --- | --- |
| `index.html` | page layout, menus, HUD and styles |
| `src/config.js` | **every tuning number**, with a comment on each |
| `src/main.js` | sets up Three.js and runs the game loop |
| `src/pulse.js` | the echo pulse shader (the glowing rings) |
| `src/level.js` | random maze generation, collisions, path-finding |
| `src/player.js` | first-person movement and footsteps |
| `src/input.js` | keyboard, mouse and pointer lock |
| `src/creature.js` | the Listener: body, hearing and AI |
| `src/items.js` | tuning forks, tin cans, pebbles, elevator |
| `src/jumpscare.js` | the jumpscare: stare, lunge and the chomping grey jaws |
| `src/audio.js` | all sounds, synthesised with the Web Audio API |
| `src/ui.js` | HUD, captions and screens |

## Tweaking

Open `src/config.js`, change a number, save, and reload the page.
Some good ones to start with:

- `creature.huntSpeed`: how fast it chases you
- `creature.huntDistance`: how close a sound must be before it starts hunting
- `actions.clapRadius` / `actions.clapLoudness`: how far you see vs. how far it hears
- `pulse.fadeTime`: how long the world stays visible after a pulse
- `creature.loseTrackTime`: how long you must stay silent to shake it off
- `creature.eyeGlow` / `creature.eyeGlowHunting`: how visible its white eyes are in total darkness (0 = only when a pulse lights them)

The jumpscare is intense: `jumpscare.shake` (camera shake and zoom punch, 0 = off for
motion-sensitive players) and `jumpscare.volume` tone it down.

If the game runs slowly, set `graphics.bloom` to `false` or lower `graphics.maxPixelRatio`.

Tip: open the browser console (F12) and type `ECHO` to inspect the live game state.
