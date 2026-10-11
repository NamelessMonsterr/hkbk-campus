# Recording 2 frame extraction report

## Source verification
20 August 22, 2026 originals from Cllg 2.zip; IMG_3887.MOV is locally named big.MOV and matched by archive size/CRC32

## Settings
- Candidate sampling: 2 fps
- Maximum output width: 1920px
- JPEG quality: FFmpeg `-q:v 3`
- Filtering: sharpness/luma gate, minimum temporal gap, and average-hash near-duplicate check.

## Results
- Sources processed: 20
- Candidates: 1004
- Selected frames: 211
- Rejected candidates: 793
- Selected output size: 63,484,210 bytes

## Per-source counts
| Source | Candidates | Selected | Rejected |
|---|---:|---:|---:|
| IMG_3882.MOV | 47 | 10 | 37 |
| IMG_3883.MOV | 46 | 10 | 36 |
| IMG_3884.MOV | 41 | 9 | 32 |
| IMG_3885.MOV | 37 | 8 | 29 |
| IMG_3887.MOV | 361 | 73 | 288 |
| IMG_3888.MOV | 23 | 5 | 18 |
| IMG_3889.MOV | 46 | 10 | 36 |
| IMG_3890.MOV | 47 | 10 | 37 |
| IMG_3891.MOV | 21 | 5 | 16 |
| IMG_3892.MOV | 15 | 3 | 12 |
| IMG_3893.MOV | 31 | 7 | 24 |
| IMG_3894.MOV | 48 | 10 | 38 |
| IMG_3895.MOV | 31 | 7 | 24 |
| IMG_3896.MOV | 10 | 2 | 8 |
| IMG_3897.MOV | 36 | 8 | 28 |
| IMG_3898.MOV | 30 | 6 | 24 |
| IMG_3899.MOV | 50 | 10 | 40 |
| IMG_3900.MOV | 23 | 5 | 18 |
| IMG_3901.MOV | 33 | 7 | 26 |
| IMG_3902.MOV | 28 | 6 | 22 |

## Validation
- All selected images valid: **True**
- Chronology valid within each clip: **True**
- Missing selected images: 0
- Corrupt selected images: 0
- Invalid dimensions: 0

## Artifacts
- `tools/extract_recording2.py`
- `output/recording2_frames/source_inventory.csv` and `.json`
- `output/recording2_frames/extraction_manifest.csv` and `.json`
- `output/recording2_frames/selected/`
- `output/recording2_frames/contact_sheet_selected.jpg`
- `output/recording2_frames/extraction_report.json`

## Exclusions and limitations
- `IMG_3886.MOV` was absent from both the source directory and archive.
- `Part1.mp4` and `Part 2.mp4` were excluded as re-encoded derivatives of the long `IMG_3887.MOV` source, not independent captures.
- Source-clip boundaries are retained; the output does not claim spatial continuity between clips.
- Existing website files and the existing 125-frame walkthrough were left unchanged.
