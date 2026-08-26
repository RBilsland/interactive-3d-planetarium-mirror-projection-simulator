# DomeCast Simulator

An interactive 3D design tool for a single-projector, convex spherical-mirror planetarium system. It traces a configurable pixel-ray grid from the projector, reflects it from the mirror, and maps the resulting footprint onto a hemispherical dome in real time.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Drag to orbit, scroll to zoom, and right-drag to pan.

## Live demo

https://rbilsland.github.io/interactive-3d-planetarium-mirror-projection-simulator/

Pushes to `main` run tests, build the site, and deploy it to GitHub Pages automatically.

## Features

- Adjustable dome, mirror, and projector geometry in meters
- Projector pitch, vertical FOV, aspect ratio, and vertical lens shift
- Horizontal lens shift stays locked at zero to keep a symmetrical centre-line image
- Exact ray/sphere intersections and specular reflection
- Projector chassis occlusion using an oriented ray/box test
- Color-coded valid, overshot, and occluded ray paths
- Projected pixel grid overlaid on the inner dome
- Spherical-triangle footprint area calculation for dome coverage
- Beam clearance measurement that keeps the projector chassis out of the light path
- Local 4K equirectangular (360×180) source preview on the dome with yaw, pitch, and roll
- Source preview shows only the projector’s lit footprint (FOV, pitch, lens shift, and coverage), not the whole sky
- Downloadable Paul Bourke warp mesh (`.data`) generated from the current optical setup
- Named setups saved in the browser, listed for reload, and deletable when finished with
- Responsive controls and live trace analytics

## Equirectangular source and warp mesh

Choose a 2:1 equirectangular image (ideally 4096×2048) under **Equirectangular source**. The image is held only for the current session through an object URL; named setups store geometry, display toggles, and orientation, but not the image file itself. Re-select the image after loading a saved setup.

With **Source preview** enabled, the panorama is drawn only where valid projector rays hit the dome after reflecting from the mirror. Changing FOV, pitch, lens shift, or throw reshapes that footprint so you see what the projector would put on the sky — not the full hemisphere. **Source orientation** yaw/pitch/roll turn the panorama within that footprint. Longitude 0 faces the dome front (`+Y`); latitude runs from horizon to zenith.

**Download warp mesh** exports a Paul Bourke rectangular mesh in the same style as `standard_16x9.data.txt`:

1. Input type `4` (spherical / equirectangular panorama)
2. Mesh size `100 60`
3. 6,000 rows of `x y u v intensity`

Projector coordinates `(x,y)` form a regular normalised screen grid (`-aspect…+aspect`, `-1…+1`). Texture coordinates `(u,v)` sample the equirectangular source at the dome direction each projector pixel would light after mirror reflection. Intensity is `1` for usable nodes and `-1` for missed nodes so consumers can skip unusable cells. By default chassis-occluded rays are excluded; turn on **Include occluded in mesh** to keep them in the download and in the source preview. The download filename uses the current saved-setup name when one is entered.

## Coordinate system

The simulation uses meters with `Z` up. The dome is centered at the origin with its base on `Z = 0`. The mirror stays in contact with the rear of the dome shell at any height: its rear face is flat, so it is pushed back until the top of that face meets the shell, sliding forward along the curve as its height rises. The projector faces backward toward it. Both the mirror and the projector can be dropped to floor level.

## Verification

```bash
npm test
npm run build
```

The math tests cover sphere intersections, reflection, component placement, ray classification, lens shift, named local saves, equirectangular mapping, and warp-mesh export.
