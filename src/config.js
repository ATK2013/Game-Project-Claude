// =====================================================================
//  ECHO — config.js
//  EVERY tuning number in the game lives here. Change a value, save,
//  and reload the browser tab to try it out.
//  Distances are in metres, times in seconds, speeds in metres/second.
// =====================================================================

export const CONFIG = {
  // ---------------------------------------------------------------
  // Graphics
  // ---------------------------------------------------------------
  graphics: {
    fov: 75,               // camera field of view in degrees
    maxPixelRatio: 1.25,   // caps resolution on high-DPI screens (lower = faster)
    bloom: true,           // soft glow around bright lines (turn off if slow)
    bloomStrength: 0.9,    // how strong the glow is
    bloomRadius: 0.35,     // how far the glow spreads
    bloomThreshold: 0.25,  // brightness needed before something glows
    grain: 0.05,           // film-grain amount on screen (0 = none)
    dustPerCell: 16,       // number of flickering "salt" dots per open grid cell
  },

  // ---------------------------------------------------------------
  // Echo pulses (the rings of light)
  // ---------------------------------------------------------------
  pulse: {
    maxPulses: 16,         // how many pulses can exist at once (shader array size)
    speed: 15,             // how fast a ring spreads (m/s)
    fadeTime: 2.0,         // how long a surface keeps glowing after the ring passes
    frontWidth: 0.09,      // thickness of the bright wavefront (in seconds of travel)
    falloff: 1.2,          // how quickly pulses weaken with distance (bigger = faster)
    surfaceFill: 0.035,     // how much flat surfaces glow (lines always glow more)
    playerColor: [0.50, 0.88, 1.00],   // pale cyan-white (R, G, B from 0 to 1)
    creatureColor: [1.00, 0.10, 0.06], // red
    forkColor: [1.00, 0.72, 0.30],     // warm gold
    elevatorColor: [0.55, 1.00, 0.55], // pale green
    objectColor: [0.85, 0.85, 0.80],   // white-ish (pebbles, cans)
  },

  // ---------------------------------------------------------------
  // Player movement
  // ---------------------------------------------------------------
  player: {
    walkSpeed: 2.6,        // normal walking speed
    runSpeed: 4.6,         // speed while holding Shift
    creepSpeed: 1.1,       // speed while holding C
    acceleration: 12,      // how quickly you reach full speed (higher = snappier)
    eyeHeight: 1.6,        // camera height above the floor
    radius: 0.35,          // collision size of the player
    mouseSensitivity: 0.0022, // mouse look speed
    strideWalk: 1.5,       // metres between footsteps when walking
    strideRun: 2.0,        // metres between footsteps when running
    strideCreep: 1.0,      // metres between (silent) footsteps when creeping
    headBob: 0.035,        // how much the camera bobs while walking
    jumpSpeed: 4.6,        // how hard you jump (higher = higher and longer jumps)
    gravity: 12,           // how fast you fall back down
    startPebbles: 3,       // pebbles you start with
    maxPebbles: 8,         // most pebbles you can carry
  },

  // ---------------------------------------------------------------
  // Sounds the player makes. "loudness" = how many metres away the
  // creature can hear it (in open air, before walls muffle it).
  // ---------------------------------------------------------------
  actions: {
    clapRadius: 18,        // size of the clap pulse
    clapLoudness: 30,      // how far the creature hears a clap
    clapCooldown: 1.2,     // seconds between claps (difficulty can change this)
    snapRadius: 5,         // size of the finger-snap pulse
    snapLoudness: 8,       // how far the creature hears a snap
    snapCooldown: 0.35,    // seconds between snaps
    stepRadiusWalk: 1.5,   // footstep pulse size when walking
    stepRadiusRun: 3.0,    // footstep pulse size when running
    stepLoudnessWalk: 7,   // how far the creature hears walking
    stepLoudnessRun: 15,   // how far the creature hears running
    throwSpeed: 10,        // how hard a pebble is thrown
    throwCooldown: 0.6,    // seconds between throws
    pebbleRadius: 4,       // pulse size when a pebble lands
    pebbleLoudness: 18,    // how far the creature hears a pebble land
    canRadius: 7,          // pulse size when you kick a tin can
    canLoudness: 22,       // how far the creature hears a tin can
    landRadius: 2.4,       // pulse size when you land from a jump
    landLoudness: 9,       // how far the creature hears you land
    fallLoudness: 26,      // how far the creature hears you crash into a crevice
    leverLoudness: 8,      // how far the creature hears a lever clunk
    gateLoudness: 24,      // how far the creature hears a gate grinding
    bellLoudness: 45,      // how far the creature hears a bell (a big distraction)
  },

  // ---------------------------------------------------------------
  // Keyboard keys for each action (names from KeyboardEvent.code).
  // Example: to clap with Space again, use clap: ['Space'] and jump: ['KeyJ'].
  // ---------------------------------------------------------------
  keys: {
    jump: ['Space'],       // jump
    clap: ['KeyF'],        // clap (left mouse button also claps)
    snap: ['KeyQ'],        // snap (right mouse button also snaps)
    throw: ['KeyE'],       // throw a pebble, or pull a lever when you stand next to one
    pause: ['Escape'],     // pause
  },

  // ---------------------------------------------------------------
  // Map features: things to jump over and levers to pull
  // ---------------------------------------------------------------
  features: {
    pits: 3,               // crevices across tunnels that you must jump over
    pitWidth: [1.3, 1.8],  // min/max width in metres (a walking jump clears about 2 m)
    pitDepth: 3,           // how deep they are
    fallTime: 1.4,         // seconds before you climb back out after falling in
    hurdles: 3,            // fallen beams you must jump over (or climb onto)
    hurdleHeight: 0.55,    // beam height (a jump goes about 0.9 m high)
    gates: 2,              // iron gates opened by levers (the creature can't pass a closed gate)
    decoyLevers: 2,        // levers that ring a far-away bell: a loud distraction
    decoyCooldown: 25,     // seconds before a bell lever can be pulled again
    leverReach: 1.5,       // how close you must be to pull a lever
    gateSpeed: 1.2,        // how fast gates rise and fall (metres per second)
  },

  // ---------------------------------------------------------------
  // The creature ("the Listener")
  // ---------------------------------------------------------------
  creature: {
    wanderSpeed: 1.3,      // slow roaming speed
    investigateSpeed: 2.4, // speed when walking to a sound it heard
    huntSpeed: 3.7,        // chase speed (between walking and running)
    huntDistance: 12,      // player sounds heard closer than this start a HUNT
    loseTrackTime: 4.5,    // seconds of silence before it gives up the hunt
    investigateLinger: 4,  // seconds it waits and listens at a sound's location
    wallMuffle: 7,         // each block of rock between it and a sound adds this many metres
    clickRadius: 10,       // size of its red echolocation pulse
    clickWander: [4, 7],   // min/max seconds between clicks while wandering
    clickInvestigate: [2.5, 4], // ...while investigating
    clickHunt: [1.1, 1.8], // ...while hunting
    catchRadius: 0.9,      // how close it must get to catch you
    spawnMinDistance: 32,  // it starts at least this far (path distance) from you
    height: 2.7,           // how tall it is
    stepLength: 0.9,       // metres between its dragging footsteps
    // --- its eyes: the body is pitch black, only the white eyes show ---
    eyeSize: 110,          // size of the eye glow (bigger = larger eyes on screen)
    eyeShine: 5,           // how brightly the eyes catch the light of a pulse
    eyeGlowDistance: 14,   // within this distance the eyes glow faintly even in darkness
    eyeGlow: 0.3,          // how bright that faint glow is (0 = only visible when lit)
    eyeGlowHunting: 0.7,   // ...and how bright while it is hunting you
    blinkEvery: [4, 9],    // min/max seconds between blinks (it never blinks while hunting)
    stareDistance: 16,     // closer than this, its head turns to stare at you
    breathDistance: 8,     // closer than this, you can hear it breathing
  },

  // ---------------------------------------------------------------
  // Difficulty presets. Multipliers are applied on top of the values above.
  // ---------------------------------------------------------------
  difficulty: {
    easy:   { creatureSpeed: 0.8, hearing: 0.75, clapCooldown: 0.9 },
    normal: { creatureSpeed: 1.0, hearing: 1.0,  clapCooldown: 1.2 },
    hard:   { creatureSpeed: 1.2, hearing: 1.35, clapCooldown: 1.6 },
  },
  defaultDifficulty: 'normal', // which preset is selected on the title screen

  // ---------------------------------------------------------------
  // Level generation
  // ---------------------------------------------------------------
  level: {
    gridSize: 23,          // maze size in cells (must be an odd number)
    cellSize: 3,           // width of one grid cell / tunnel in metres
    wallHeight: 3.2,       // tunnel height
    loopChance: 0.14,      // chance to knock out extra walls (more loops = easier escapes)
    chambers: 5,           // number of small open chambers
    wallJitter: 0.16,      // how rough/uneven the walls look (visual only)
    supportChance: 0.3,    // chance of a wooden support frame in a straight tunnel
    crateChance: 0.18,     // chance of crates in a corner
    tinCans: 12,           // tin cans scattered on the floor
    pebblePiles: 7,        // piles of pebbles you can pick up
  },

  // ---------------------------------------------------------------
  // Goal objects
  // ---------------------------------------------------------------
  goal: {
    forkCount: 4,          // tuning forks to collect
    forkPulseRadius: 4,    // size of each fork's faint ripple
    forkPulseInterval: 3.5,// seconds between fork ripples
    forkPickupDistance: 1.2, // how close you must be to grab a fork
    forkRingRadius: 12,    // pulse size when a fork is picked up
    forkRingLoudness: 35,  // how far the creature hears a fork being picked up
    elevatorPulseRadius: 22, // pulse size when the elevator powers up
    elevatorBeaconInterval: 3, // seconds between elevator beacon pulses
    elevatorHumLoudness: 22, // the running elevator keeps making this much noise
    elevatorReachDistance: 1.4, // how close you must get to escape
  },

  // ---------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------
  audio: {
    masterVolume: 0.8,     // overall volume (0 to 1)
    reverbSeconds: 3.2,    // length of the cave echo
    reverbWet: 0.45,       // how much echo is mixed in
    droneVolume: 0.10,     // low background rumble
    dripMin: 2,            // min seconds between water drips
    dripMax: 6,            // max seconds between water drips
    heartbeatDistance: 22, // heartbeat starts when the creature is this close
    heartbeatSlowBPM: 60,  // heartbeat speed when it is far
    heartbeatFastBPM: 150, // heartbeat speed when it is right next to you
  },

  // ---------------------------------------------------------------
  // Jumpscare (what happens when it catches you)
  // ---------------------------------------------------------------
  jumpscare: {
    shake: 1.0,            // camera shake + zoom punch strength (0 = none, for motion-sensitive players)
    volume: 1.0,           // loudness of the jumpscare sounds (0 to 1)
  },

  // ---------------------------------------------------------------
  // Multiplayer (rooms with friends)
  // ---------------------------------------------------------------
  multiplayer: {
    maxPlayers: 4,         // players per room, including the host
    sendRate: 15,          // position updates sent per second (higher = smoother, more data)
    smoothing: 12,         // how quickly friends' positions catch up (higher = snappier)
    joinTimeout: 10,       // seconds to wait when joining before giving up
    codeLength: 5,         // letters in a room code
    feedTime: 4,           // after catching someone, the creature stands still this long
    // Each player's pulse + body colour (host first). R, G, B from 0 to 1.
    colors: [[0.50, 0.88, 1.00], [0.75, 0.62, 1.00], [1.00, 0.56, 0.80], [0.95, 0.95, 0.90]],
    colorNames: ['cyan', 'violet', 'pink', 'white'],
    // Options for the PeerJS connection broker. Leave empty to use the free
    // public PeerJS server, or e.g. { host: 'my.server.com', port: 443, path: '/' }.
    peerOptions: {},
  },

  // ---------------------------------------------------------------
  // Mobile mode (phones and tablets). Turned on automatically on touch
  // devices. Force it with ?mobile=1 in the address, or turn it off with ?mobile=0.
  // ---------------------------------------------------------------
  mobile: {
    maxPixelRatio: 1.5,    // phones have very sharp screens: cap the resolution to stay smooth
    bloom: true,           // glow effect (set false if your phone gets hot or slow)
    dustPerCell: 8,        // fewer flickering dots than on desktop
    lookSensitivity: 3.2,  // how fast dragging your right thumb turns your head
    stickRadius: 60,       // size of the movement joystick in pixels
    creepZone: 0.45,       // push the stick less than this much = creep (silent)
    runZone: 0.92,         // push it further than this = run (loud)
    vibrate: true,         // short vibrations on claps and when it bites (Android)
    lightAudio: true,      // simpler 3D sound on phones/tablets (stops crackling and clicking noises)
    maxSounds: 20,         // most sounds playing at once on phones/tablets (extra ones are skipped)
  },

  // ---------------------------------------------------------------
  // Captions / HUD
  // ---------------------------------------------------------------
  ui: {
    captions: true,        // show captions for important sounds by default
    captionTime: 3.5,      // seconds a caption stays on screen
    closeDistance: 8,      // sounds closer than this are "close"
    nearDistance: 18,      // closer than this are "nearby", beyond = "distant"
    noiseDecay: 1.4,       // how fast the noise meter falls back down
  },
};
