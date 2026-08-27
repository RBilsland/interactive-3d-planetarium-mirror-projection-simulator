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

- Adjustable dome and mirror diameters, plus projector geometry in meters
- Mirror pitch-down, projector pitch, diagonal FOV, aspect ratio, and vertical lens shift
- Horizontal lens shift stays locked at zero to keep a symmetrical centre-line image
- Exact ray/sphere intersections and specular reflection
- Projector chassis occlusion using an oriented ray/box test
- Color-coded valid, overshot, and occluded ray paths
- Projected pixel grid overlaid on the inner dome
- Spherical-triangle footprint area calculation for dome coverage
- Beam clearance measurement that keeps the projector chassis out of the light path
- Local fulldome source preview (1:1 fisheye or 2:1 equirectangular) with yaw, pitch, and roll
- Source preview shows only the projector’s lit footprint (FOV, pitch, lens shift, and coverage), not the whole sky
- Downloadable Paul Bourke warp mesh (`.data`) generated from the current optical setup
- Named setups saved in the browser, listed for reload, and deletable when finished with
- Responsive controls and live trace analytics

## Dome source image and warp mesh

Choose a source image under **Dome source image**. Aspect ratio selects the layout automatically:

- **1:1** → hemispherical fisheye (zenith at centre, horizon on the image circle)
- **2:1** → equirectangular panorama (ideally 4096×2048)

Any other aspect ratio is rejected. The image is held only for the current session through an object URL; named setups store geometry, display toggles, and orientation, but not the image file itself. Re-select the image after loading a saved setup.

With **Source preview** enabled, the source is drawn only where valid projector rays hit the dome after reflecting from the mirror. Changing FOV, pitch, lens shift, or throw reshapes that footprint so you see what the projector would put on the sky — not the full hemisphere. **Source orientation** yaw/pitch/roll turn the image within that footprint. For equirectangular sources, longitude 0 faces the dome front (`+Y`) and latitude runs from horizon to zenith. For fisheye sources, the dome front maps toward the bottom of the frame.

**Download warp mesh** exports a Paul Bourke rectangular mesh in the same style as `standard_16x9.data.txt`:

1. Input type `2` (fisheye) or `4` (spherical / equirectangular panorama), matching the loaded source
2. Mesh size `<columns> <rows>` cropped to the mapped projector footprint — outer rows/columns with no lit pixels are omitted; internal gaps stay as `intensity -1` so neighbour connectivity is preserved for triangulation
3. Row-major grid rows of `x y u v intensity`

Projector coordinates `(x,y)` form a regular normalised screen grid (`-aspect…+aspect`, `-1…+1`) within that footprint. Texture coordinates `(u,v)` sample the loaded source at the dome direction each projector pixel would light after mirror reflection. Intensity is `-1` for missed nodes. For mapped nodes it is the total projector→mirror→dome path length normalised to the longest ray in the export (`1` = longest path, shorter paths below `1`) so downstream warpers can dim closer hits and improve dome uniformity. By default chassis-occluded rays are excluded; turn on **Include occluded in mesh** to keep them in the download and in the source preview. The download filename uses the current saved-setup name when one is entered.

The live source preview uses the same footprint detection: it traces and tessellates only the projector region that maps onto the dome, rather than iterating the full ray grid every frame.

**Export setup JSON** downloads the current optical parameters, source orientation, and mesh occlusion flag as `domecast-setup-v1` JSON. Use this file to recreate the same geometry in external runtimes such as a macOS Metal per-pixel warper.

## Coordinate system

The simulation uses meters with `Z` up. The dome is centered at the origin with its base on `Z = 0`. The mirror stays in contact with the rear of the dome shell at any height: its rear face is flat, so it is pushed back until the top of that face meets the shell, sliding forward along the curve as its height rises. The projector faces backward toward it. **Mirror distance** is the gap from the front of the mirror (dome-facing optical surface) to the front of the projector chassis; `0` means they touch, and the maximum places the projector front at the dome mid-plane (`Y = 0`). Both the mirror and the projector can be dropped to floor level.

## Verification

```bash
npm test
npm run build
```

The math tests cover sphere intersections, reflection, component placement, ray classification, lens shift, named local saves, equirectangular mapping, and warp-mesh export.
