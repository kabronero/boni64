# boni 64

3D minigame hub built with Three.js. TRON-style hub world with two mini-games:

- **Dame mi galletita** — pacman-ish random maze, collect all cookies before the timer runs out
- **Coca con Coca** — treasure-hunt arena, find the can and bottle as fast as possible

Featuring procedural jump/attack animations, procedural ambient synth music, and a shared scoreboard.

## Run locally

```bash
npm start
```

Open http://localhost:8765.

## Controls

- **WASD** move · **Shift** run · **Space** jump · **Mouse** camera · **Scroll** zoom · **Esc** free mouse
- **E** hit · **R** dance · **M** mute

## Deploy (Railway / any Node host)

The server reads `PORT` and `HOST` from env. Optional `DATA_DIR` to persist `scores.json` to a mounted volume.

```bash
npm start   # listens on $PORT (default 8765) bound to $HOST (default 0.0.0.0)
```
