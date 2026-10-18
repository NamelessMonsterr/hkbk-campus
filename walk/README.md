# HKBK Campus Walk

A first-person walk through the HKBK campus, from the Main Gate to the Xerox shop: 65 steps across 14 stops. Every frame is a still from real campus video.

Live: https://namelessmonsterr.github.io/hkbk-campus/walk/

## Files

- `index.html`: the player.
- `walk-data.js`: stop list (name, map position, step number) and the frame pack list with offsets.
- `frames4_0.bin`, `frames4_1.bin`: the frames, packed into two binary files.
- `manifest.json`: web app manifest linked from `index.html`.
- `assets/campus_map.jpg`: the map behind the small round position indicator.
- `lib/`: Pannellum, used for the optional 360 view.

## Controls

Start the walk, then use the arrow buttons, arrow keys, scroll or swipe. Walk plays it automatically. Restart returns to step 1.

## Run locally

The player loads its frames with `fetch`, so it needs a web server (it will not run from `file://`):

```
python3 -m http.server 8000
```

Then open http://localhost:8000/walk/.

## 360 view

To add a 360 view at a stop, set `"pano": "panos/<id>.jpg"` on that stop in `walk-data.js`. A 360 button then appears at that stop. No stop uses one right now.
