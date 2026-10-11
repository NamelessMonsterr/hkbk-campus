# CLLG Campus Explorer — Codex Handoff

**Purpose:** implementation-grounded continuation note for OpenAI Codex. This file records the current workspace state, completed Recording 2 work, provenance limits, and the next safe implementation sequence.

## Status vocabulary

- **VERIFIED** — checked against current files, generated artifacts, commands, or a current local HTTP request.
- **HISTORICAL REPORT — NOT REVERIFIED** — reported by earlier project notes or prior work, but not re-established by the current inspection.
- **NOT VERIFIED** — relevant claim or behavior has not been proved in the current workspace review.
- **NOT IMPLEMENTED** — the code/artifact explicitly does not provide the capability.

## Current state in one page

- **VERIFIED project root:** `HKBK (2)/HKBK/` under the workspace root `C:\Users\91701\Downloads\HKBK`.
- The project is a static HTML/CSS/JavaScript site with an existing 125-frame photo walkthrough and a separate Three.js campus preview.
- The existing 125-frame walkthrough is still the default route. Its source provenance is not established as Recording 2; its manifest references the older `IMG_01xx` clip family.
- A separate Recording 2 route now exists at `recording2-walkthrough.html`. It is deliberately not linked as the default from `demo.html`.
- The Recording 2 route uses an isolated dataset: `assets/tour-photos-recording2/`.
- Recording 2 dataset facts verified from current artifacts: **211 selected JPEGs, 20 source clips, 5 chapters, 20 explicit clip boundaries**.
- The route displays source MOV filename, clip-local approximate sample time, clip number/duration, chapter, and hard-cut boundary warnings.
- The existing controller `js/3d/campus/street-view.js` was extended backward-compatibly to support both the old default manifest and the independent Recording 2 manifest.
- The current quality pass is only a first-pass heuristic. It does not prove that the selected frames are sharp enough for final product use.
- The 3D preview currently has one local building GLB (`assets/models/main-block.glb`); the other registered building IDs fall back to procedural geometry when their requested GLBs 404.
- No COLMAP reconstruction, source video, old 125-frame asset, old manifest, database, or model was modified by the Recording 2 extraction/route work.
- **Current user-facing issue:** the user reports that the redesigned entry experience still looks substantially like the previous product and wants a genuinely improved, photography-led campus explorer. This handoff does not solve that design task.

## Safe local preview

From the project root:

```powershell
python -m http.server 8774 --bind 127.0.0.1
```

Routes:

- Existing entry: `http://127.0.0.1:8774/demo.html`
- Existing/default walkthrough: `http://127.0.0.1:8774/street-view.html`
- Independent Recording 2 walkthrough: `http://127.0.0.1:8774/recording2-walkthrough.html`
- Recording 2 contact sheet: `http://127.0.0.1:8774/assets/tour-photos-recording2/contact-sheet.jpg`
- 3D preview: `http://127.0.0.1:8774/campus.html`

The Recording 2 page has links back to the existing demo, the original walkthrough, and its contact sheet. It is not the default route and is not wired into `demo.html`.

## Technical chronology

### 1. Original reconstruction and photo walkthrough

The project contains a Three.js campus preview and a static image-sequence walkthrough. The reconstruction-related code includes a campus scene, a building registry, a semantic camera director, conversational spatial context, telemetry, and vendored Three.js modules. The current campus viewer is a Phase 1-style preview, not a completed surveyed digital twin.

The original photo route is represented by:

- `assets/tour-photos/f0001.jpg` through `f0125.jpg`
- `assets/tour-photos/manifest.json`
- `street-view.html`
- `css/street-view.css`
- `js/3d/campus/street-view.js`

The original route has 125 frames and four chapters: `1–7`, `8–15`, `16–25`, and `26–125`. The manifest source fields include clips such as `IMG_0204`, `IMG_0205`, `IMG_0201`, and `IMG_0192`; these are Recording 1-style numbers, not the August 22 Recording 2 originals.

### 2. Problems that led to the Recording 2 work

The prior release-readiness pass verified functional behavior, asset loading, and visual screenshots, but did not prove that the existing 125 images came from the user-required Recording 2. The original route also made a curated sequence from multiple clips without establishing complete source provenance in its current manifest. Therefore, a functionally good 125-frame route was not evidence of correct source-footage selection.

The user explicitly required **Recording 2 / August 22, 2026** and explicitly prohibited substituting **Recording 1 / August 6**.

### 3. Recording sets

#### Recording 1 — August 6

- **VERIFIED current location:** `HKBK (2)/HKBK/video/video/` contains 39 loose `.MOV` files.
- The observed numbering is approximately `IMG_0165.MOV` through `IMG_0205.MOV`, with gaps at `IMG_0183.MOV` and `IMG_0186.MOV`.
- `video.zip` and `Clg.zip` are archive packages of this older set according to the prior inventory.
- It is excluded from the Recording 2 extraction and route.

#### Recording 2 — August 22

- **VERIFIED current source directory:** `C:\Users\91701\Downloads\HKBK\Cllg 2\`.
- **VERIFIED archive:** `C:\Users\91701\Downloads\HKBK\Cllg 2.zip`.
- The directory contains 20 original MOVs plus two MP4 derivatives (`Part1.mp4`, `Part 2.mp4`).
- The selected original sequence is `IMG_3882.MOV`–`IMG_3885.MOV`, then `IMG_3887.MOV`–`IMG_3902.MOV`.
- `IMG_3886.MOV` is absent from the source directory and archive.
- The local file `Cllg 2\big.MOV` is used for the archive member named `IMG_3887.MOV`. Its SHA-256 in the inventory is `21a66eefe119df65357ac6835eea9260463738fea23d6f6ac54df64a245a972c`; the archive member and local file were also size/CRC matched.
- The 20 original files report approximately 3840×2160 HEVC at approximately 59.97 fps in the source inventory. `IMG_3900.MOV` has `-90` rotation metadata in the inventory.
- `Part1.mp4` and `Part 2.mp4` are excluded as re-encoded derivatives of the long `IMG_3887.MOV`/`big.MOV` capture, not independent original route clips.

The source filenames establish inventory order only. They do **not** prove physical route continuity between clips.

## Recording 2 extraction pipeline

### Inputs and outputs

The extraction implementation is `tools/extract_recording2.py`. It is isolated from the existing website route and writes to:

`output/recording2_frames/`

Important generated artifacts:

- `source_inventory.csv` / `source_inventory.json` — source metadata, archive evidence, exclusions, and hashes.
- `extraction_manifest.csv` / `extraction_manifest.json` — one row for every candidate, including selected and rejected rows.
- `candidates/` — **VERIFIED:** 1,004 candidate JPEGs retained after the last run, grouped by source clip.
- `selected/` — **VERIFIED:** 211 selected JPEGs grouped by source clip.
- `contact_sheet_selected.jpg` — 40 representative selected frames from the extraction output, not the later 60-tile route contact sheet.
- `extraction_report.md` / `extraction_report.json` — counts, settings, source exclusions, and validation results.

### Actual extraction settings

**VERIFIED from the script and report:**

- Candidate rate: `2.0 fps`.
- Maximum output width: `1920` pixels, aspect ratio retained by FFmpeg scaling.
- JPEG quality: FFmpeg `-q:v 3`.
- Explicit video stream mapping: `-map 0:v:0`.
- CPU/FFmpeg extraction; no audio output.
- 20 original source clips processed.
- Candidate count: **1,004**.
- Selected count: **211**.
- Rejected count: **793**.
- Selected output size: **63,484,210 bytes** in the extraction `selected/` tree.

The script invokes FFmpeg with `-nostdin -n`; its rerun behavior clears only its own `output/recording2_frames/candidates/` and `selected/` directories before regenerating them. It does not touch source videos, archives, existing tour assets, or reconstruction files.

### Current quality filter

The filter is implemented in `filter_candidates()` and applies these checks in order:

1. Decode the candidate with Pillow.
2. Compute a grayscale edge-energy score called `sharpness()` after resizing to 320×180. This is **not** a variance-of-Laplacian implementation; it is an average squared 4-neighbour Laplacian-like energy.
3. Compute mean grayscale luminance.
4. Reject mean luminance below `8.0` as `near_black_frame`.
5. Reject edge energy below `18.0` as `low_edge_energy_possible_blur`.
6. Enforce at least `2.5` seconds since the previous selected frame in that clip.
7. Reject a candidate if its 16×16 average hash is within Hamming distance `< 8` of the last selected frame in that clip.

**Important quality status:**

- **VERIFIED implemented:** edge-energy sharpness proxy, near-black rejection, temporal spacing, average-hash near-duplicate rejection, decode handling.
- **NOT IMPLEMENTED:** optical-flow or motion-blur measurement, camera-motion estimation, face/people obstruction scoring, exposure/highlight/shadow scoring, semantic viewpoint ranking, learned quality ranking, per-clip visual quotas, native-resolution quality comparison, and source-vs-output blur diagnosis.
- Candidate sampling is uniform and the minimum temporal gap plus last-selected hash logic creates selection bias toward the first acceptable viewpoint after each gap. There is no global route optimization.
- The extracted output is downscaled from the 3840×2160 source to at most 1920 pixels wide and JPEG-recompressed. It cannot be used to prove whether blur originated in the source or was introduced by extraction.
- The report's `sharpness_score` is a ranking/filter signal only; it is not a human-quality guarantee.

### Extraction validation actually present

The extraction report records:

- 211 selected manifest entries.
- 0 missing selected images.
- 0 corrupt selected images.
- 0 invalid dimensions.
- 0 ordering errors within clips.
- Per-source selected counts.

The current workspace also has a generated contact sheet that was visually inspected. It shows real HKBK campus footage and viewpoint variation, but that inspection does not establish that every chosen image is sharp enough for publication.

## Recording 2 route dataset and provenance

### Route builder

`tools/build_recording2_route.py` consumes only `output/recording2_frames/source_inventory.json` and `output/recording2_frames/extraction_manifest.json`. It refuses stale/mismatched source archive evidence, refuses missing selected files, refuses divergent existing destination files, and copies selected JPEG bytes exactly.

The destination is isolated:

`assets/tour-photos-recording2/`

It does not overwrite `assets/tour-photos/`.

### Route artifacts

- `assets/tour-photos-recording2/f0001.jpg` through `f0211.jpg` — exact byte copies of selected extraction JPEGs.
- `assets/tour-photos-recording2/manifest.json` — route manifest.
- `assets/tour-photos-recording2/README.md` — generated route notes, boundaries, gaps, and limitations.
- `assets/tour-photos-recording2/contact-sheet.jpg` — 60 tiles: first, middle, and last selected view for each of the 20 original clips, labelled with source filename and clip-local `t`.

### Route chapters and frame ranges

The chapter groupings are based on review of the generated contact sheet and the verified source-order inventory. They are not a claim of surveyed spatial continuity.

| Chapter ID | Label | Route frames | Source clips |
|---|---|---:|---|
| `gate-front-approach` | Gate and front approach | 1–37 | `IMG_3882.MOV`, `3883`, `3884`, `3885` |
| `entrance-interiors-campus-lanes` | Entrance, interiors and campus lanes | 38–110 | `IMG_3887.MOV` |
| `building-entrances-tree-lined-lanes` | Building entrances and tree-lined lanes | 111–150 | `IMG_3888.MOV`–`IMG_3893.MOV` |
| `covered-spaces-outer-lanes` | Covered spaces and outer lanes | 151–193 | `IMG_3894.MOV`–`IMG_3899.MOV` |
| `rotated-final-passages` | Rotated view and final building passages | 194–211 | `IMG_3900.MOV`–`IMG_3902.MOV` |

All 20 clip boundaries are retained. Route-frame clip starts are:

`1, 11, 21, 30, 38, 111, 116, 126, 136, 141, 144, 151, 161, 168, 170, 178, 184, 194, 199, 206`.

The route manifest marks each first selected frame from a source clip with `clip_start: true`. Clip-local timestamps reset to `0.0` at each boundary. `IMG_3886.MOV` is an explicit source-numbering gap between `IMG_3885.MOV` and `IMG_3887.MOV`.

### Frame-to-source trace

For a displayed route frame, use `assets/tour-photos-recording2/manifest.json`:

1. Find the route frame by `file`, e.g. `f0042.jpg`.
2. Read `clip`, `source_relative_path`, `archive_member`, `t`, `source_frame_approx`, `extraction_frame_id`, `frame_id`, `sequence_index`, `sha256`, and `timestamp_basis`.
3. Use `extraction_frame_id` and `source_clip` to find the selected row in `output/recording2_frames/extraction_manifest.json`.
4. Use that row's `output` to locate the selected extraction JPEG under `output/recording2_frames/selected/`.
5. Use `source_clip` plus `source_inventory.json` to resolve the original source path, source duration, frame rate, source SHA-256, archive member, and archive size/CRC proof. For `IMG_3887.MOV`, the local source path is `Cllg 2\big.MOV`.

The browser displays the route frame's original archive/source filename and approximate clip-local timestamp. The UI deliberately labels `t` as approximate because the extractor uses candidate sampling time rather than a decoded presentation timestamp.

### Metadata retained and lost by route conversion

**Retained in the route manifest:**

- Route file and route order.
- Original clip identity and source-relative path.
- Archive member identity.
- Clip-local approximate timestamp.
- Approximate source frame number.
- Extraction candidate/frame ID.
- Source dimensions.
- Selected JPEG SHA-256.
- `clip_start` boundary marker.
- Per-clip duration, selected start/end timestamps, selected count, and explicit boundary note.

**Not retained in each route-frame object:**

- Extraction `decision` (all route rows are selected by definition).
- `reason` and rejection reason fields.
- `sharpness_score`.
- `mean_luma`.
- Extraction source frame rate, source duration, extraction run timestamp, sampling FPS, JPEG quality, max output width, and candidate path.
- Absolute source path, by design.
- Verified capture clock time; it was not available and is omitted.

The extraction manifest remains the source for quality-selection metadata. Do not infer quality or exact PTS from the route manifest alone.
