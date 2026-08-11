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

## Model viewer

Web app aparte en `viewer/` — orbitá a Boni en 360°, disparás cualquiera de sus 11
animaciones y te bajás el modelo para usarlo en otro motor.

Abrir http://localhost:8765/viewer/ (mismo server).

- **Animaciones**: los clips del GLB salen como `NlaTrack.00X`; el viewer los muestra
  con los nombres que usa el juego (ver `DEFAULT_MAPPING` en `main.js`).
- **Reproducción**: play/pausa, loop, scrub de timeline, velocidad, root motion on/off.
- **Cámara**: giro automático 360°, presets frente/perfil/espalda/cara, zoom y pan.
- **Vista**: wireframe, esqueleto, grilla, sombra, glow emisivo, exposición, captura PNG.
- **Descargas**: `.glb` (glTF 2.0 binario) — un archivo con malla + esqueleto +
  animaciones + textura, que importan Godot, Unity (glTFast), Unreal, Blender,
  three.js, Babylon y PlayCanvas.

Se ofrecen dos variantes:

| Archivo | Triángulos | Peso | Para qué |
|---|---|---|---|
| `viewer/downloads/boni-lite.glb` | 56 k | 3.8 MB | tiempo real / juegos |
| `boni.glb` | 936 k | 38 MB | original sin optimizar |

La variante liviana se regenera con `npm run build:lite` (usa `@gltf-transform/cli`,
descarta ~94 % de los triángulos y conserva los 42 huesos y los 11 clips).

> Nota sobre la escala: el rig de Tripo trae escala en la bind pose, así que
> `Box3.setFromObject()` devuelve ~0.21 unidades mientras el personaje skinneado mide
> ~0.82. El viewer mide vértices deformados (`measureSkinnedBounds`) para normalizar
> la altura a 1.8.

## Deploy (Railway / any Node host)

The server reads `PORT` and `HOST` from env. Optional `DATA_DIR` to persist `scores.json` to a mounted volume.

```bash
npm start   # listens on $PORT (default 8765) bound to $HOST (default 0.0.0.0)
```
