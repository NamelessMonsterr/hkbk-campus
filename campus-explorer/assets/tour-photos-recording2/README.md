# Recording 2 isolated route dataset

This directory is an isolated, additive dataset. It does not replace or modify the existing 125-frame `assets/tour-photos/` route.

## Verified build

- Originals retained: **20** (inventory order).
- Extraction candidates: **1004**; selected **211**; rejected **793**.
- Selected route JPEGs: **211**, written as `f0001.jpg` through `f0211.jpg`.
- Selection source: rows with `decision: "selected"` only from `output/recording2_frames/extraction_manifest.json`; rejected candidates are never used as replacements.
- Every route JPEG is an exact byte copy of its selected extraction JPEG; the manifest records its SHA-256 and decoded dimensions.
- Archive provenance was rechecked against `output/recording2_frames/source_inventory.json`: local size and CRC32 match the corresponding `Cllg 2.zip` member for all 20 originals.
- `IMG_3887.MOV` is the archive/original name; its local source filename is `big.MOV`.

## Chapters

Chapter `start` and `end` values are 1-based route-frame indexes, matching the existing tour manifest convention.

| ID | Label | Frames | Clips |
|---|---|---:|---|
| `gate-front-approach` | Gate and front approach | 1–37 | IMG_3882.MOV, IMG_3883.MOV, IMG_3884.MOV, IMG_3885.MOV |
| `entrance-interiors-campus-lanes` | Entrance, interiors and campus lanes | 38–110 | IMG_3887.MOV |
| `building-entrances-tree-lined-lanes` | Building entrances and tree-lined lanes | 111–150 | IMG_3888.MOV, IMG_3889.MOV, IMG_3890.MOV, IMG_3891.MOV, IMG_3892.MOV, IMG_3893.MOV |
| `covered-spaces-outer-lanes` | Covered spaces and outer lanes | 151–193 | IMG_3894.MOV, IMG_3895.MOV, IMG_3896.MOV, IMG_3897.MOV, IMG_3898.MOV, IMG_3899.MOV |
| `rotated-final-passages` | Rotated view and final building passages | 194–211 | IMG_3900.MOV, IMG_3901.MOV, IMG_3902.MOV |

## Clip starts, boundaries, and gaps

Clip `start` and `end` values are also 1-based route-frame indexes. Each frame has clip-local `t` seconds; `clip_start` is `true` only on the first selected frame of each source clip. The supplemental `start_t`/`end_t` values describe the selected range inside each source clip.

| Clip | Frames | Selected t range | Duration (s) |
|---|---:|---:|---:|
| IMG_3882.MOV | 1–10 | 0.000–22.500 | 23.63 |
| IMG_3883.MOV | 11–20 | 0.000–22.500 | 22.89 |
| IMG_3884.MOV | 21–29 | 0.000–20.000 | 20.48 |
| IMG_3885.MOV | 30–37 | 0.000–17.500 | 18.61 |
| IMG_3887.MOV | 38–110 | 0.000–180.000 | 180.65 |
| IMG_3888.MOV | 111–115 | 0.000–10.000 | 11.27 |
| IMG_3889.MOV | 116–125 | 0.000–22.500 | 22.78 |
| IMG_3890.MOV | 126–135 | 0.000–22.500 | 23.56 |
| IMG_3891.MOV | 136–140 | 0.000–10.000 | 10.46 |
| IMG_3892.MOV | 141–143 | 0.000–5.000 | 7.60 |
| IMG_3893.MOV | 144–150 | 0.000–15.000 | 15.67 |
| IMG_3894.MOV | 151–160 | 0.000–22.500 | 23.88 |
| IMG_3895.MOV | 161–167 | 0.000–15.000 | 15.47 |
| IMG_3896.MOV | 168–169 | 0.000–2.500 | 5.22 |
| IMG_3897.MOV | 170–177 | 0.000–17.500 | 17.99 |
| IMG_3898.MOV | 178–183 | 0.000–12.500 | 14.82 |
| IMG_3899.MOV | 184–193 | 0.000–22.500 | 24.76 |
| IMG_3900.MOV | 194–198 | 0.000–10.000 | 11.69 |
| IMG_3901.MOV | 199–205 | 0.000–15.000 | 16.49 |
| IMG_3902.MOV | 206–211 | 0.000–12.500 | 13.92 |

The 2 fps candidate sampling and filtering leave temporal gaps between selected frames inside a clip. Timestamps reset at every clip boundary; there is no verified continuous route time across clips. `IMG_3886.MOV` is missing from both the source directory and archive, so the source-order gap between `IMG_3885.MOV` and `IMG_3887.MOV` is retained. The filenames establish inventory/source order only; they do not prove spatial continuity.

## Metadata and limitations

- `manifest.json` contains 211 frames, 5 contact-sheet-grounded chapters, and 20 explicit source-clip boundaries.
- Frame `t` uses `candidate sampling time; approximate source PTS`.
- `source_frame_approx` is an extraction estimate from the source frame rate, not a decoded presentation timestamp.
- Capture date is present in the inventory as 2026-08-22; a verified capture time is not available, so `capture_time` is intentionally omitted from clip records.
- The contact sheet contains first/middle/last selected views for every original clip, labelled with original filename and sampling time, using aspect-preserving containment (no crop/stretch).
- Builder reruns are safe: identical existing files are retained, divergent expected files cause an error, and extra files are never deleted.

Source order used:

IMG_3882.MOV, IMG_3883.MOV, IMG_3884.MOV, IMG_3885.MOV, IMG_3887.MOV, IMG_3888.MOV, IMG_3889.MOV, IMG_3890.MOV, IMG_3891.MOV, IMG_3892.MOV, IMG_3893.MOV, IMG_3894.MOV, IMG_3895.MOV, IMG_3896.MOV, IMG_3897.MOV, IMG_3898.MOV, IMG_3899.MOV, IMG_3900.MOV, IMG_3901.MOV, IMG_3902.MOV
