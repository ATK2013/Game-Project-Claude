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

## Playing on a phone or tablet

ECHO detects phones and tablets and switches to **mobile mode** automatically:

| Touch | Action |
| --- | --- |
| Left thumb (joystick) | move: a small push creeps (silent), a normal push walks, pushing to the edge runs (loud) |
| Right thumb | drag to look around |
| CLAP / SNAP / JUMP | the same as F / Q / Space on a keyboard |
| PEBBLE (says PULL next to a lever) | the same as E |
| II | pause |

- Hold the device sideways. The game goes fullscreen and locks to landscape where the browser allows it.
- The game pauses when you switch apps. Android phones buzz on claps and bites.
- Graphics are lighter on phones. You can tune this in the `mobile` section of `src/config.js`.
- On iPhone, turn off silent mode (the switch on the side), or you won't hear anything.
- Force mobile mode with `?mobile=1` at the end of the address, or turn it off with `?mobile=0`.
  The title screen also has a link to switch.

To play on a phone, the game must be reachable from the phone's browser. GitHub Pages is the
easiest way (see "Sharing the game" below). On your home network you can also run the
server on your computer and open `http://<your-computer's-IP>:8000` on the phone.

## Playing with friends (multiplayer)

Up to 4 players can explore the mine together. Everyone sees each other's claps in
their own colour, and the Listener hears all of you.

1. Everyone opens the game in their own browser (see "Sharing the game" below).
2. One player clicks **PLAY WITH FRIENDS → CREATE A ROOM** and gets a 5-letter room code.
3. Friends click **PLAY WITH FRIENDS**, type the code and click **JOIN**.
4. The host picks a difficulty and clicks **START GAME**.

How it works together:
- The tuning forks count for the whole team.
- If the Listener catches you, you watch through a friend's eyes (SPACE switches friend).
  After a catch it stands still for a few seconds, which gives the others a chance to run.
- The game ends when nobody is left in the mine. The team wins if anyone reached the elevator.
- Multiplayer never pauses: pressing Esc opens the menu, but the creature keeps hunting.

**Sharing the game.** Each player needs to open the game. Two easy ways:
- **GitHub Pages (easiest):** in this repository on GitHub, go to *Settings → Pages* and
  publish the `main` branch. Everyone can then just open the Pages address in their browser.
  No downloads and no Python needed.
- **Local copies:** every player downloads the game and runs `python3 -m http.server`.

The connection is browser-to-browser (WebRTC, using PeerJS). PeerJS's free public server only
introduces the players to each other. Some very strict networks (some school or office
networks) block direct connections; if joining fails there, try another network.

**Testing on one computer:** open `http://localhost:8000/?net=local` in two browser tabs.
Rooms then connect the tabs to each other, with no internet needed.

## Controls

| Key | Action |
| --- | --- |
| WASD | move |
| Mouse | look around (click to capture the mouse) |
| Shift | run: faster, but louder |
| C | creep: slow and silent |
| F / left click | **clap**: big pulse (~18 m), loud, 1.2 s cooldown |
| Q / right click | **snap**: small quiet pulse (~5 m) |
| Space | **jump** over crevices and fallen beams |
| E | pull a lever when you stand next to one, otherwise throw a pebble (a distraction) |
| Esc | pause |
| Space or F (after being caught) | watch a different friend (multiplayer) |

**Goal:** find the 4 humming tuning forks (follow their gold ripples and hum),
then reach the old elevator at the far end of the mine.

All keys can be changed in the `keys` section of `src/config.js`.

### Things in the mine
- **Crevices:** gaps across a tunnel, marked by the stubs of a broken plank bridge. Jump over
  them. Miss, and you fall in with a loud crash that the creature hears, then climb back out.
- **Fallen beams:** knee-high beams across a tunnel. Jump over them (or onto them).
- **Iron gates and gate levers:** gates block some tunnels, and the creature can't get through
  a closed gate either. Each gate's lever (rusty orange, glowing faintly) is always somewhere
  you can reach. Pull it again to close the gate, maybe in the creature's face.
- **Bell levers:** ring an old mine bell far away. It's very loud, so the creature goes to look.
  Use it to lure the creature away. It needs 25 seconds before it works again.

The Listener's legs are long enough to step over crevices and beams. How many of each thing
appears, how wide crevices are, and how high you jump are all in `src/config.js`
(`features` and `player`).

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
| `src/jumpscare.js` | the jumpscare: a silent stare, a lunge, then the face shaking violently across the screen |
| `src/net.js` | multiplayer rooms and connections (PeerJS, or browser tabs with `?net=local`) |
| `src/lobby.js` | the "Play with friends" menu and the waiting room |
| `src/multiplayer.js` | keeps everyone's game in sync during a match |
| `src/touch.js` | mobile mode: phone detection and touch controls |
| `src/features.js` | places crevices, fallen beams, gates, levers and bells in each map |
| `src/mechanisms.js` | levers, gates and bells: pulling, opening, ringing |
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
