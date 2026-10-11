#!/usr/bin/env python3
"""Extract, filter, and validate an isolated Recording 2 frame set.

This script deliberately does not touch the website's existing tour assets.
It uses the August 22 source originals in ``Cllg 2`` and excludes the two
re-encoded Part*.mp4 derivatives as well as the August 6 Recording 1 clips.

Example (from the workspace root):
    py -3.11 "HKBK (2)/HKBK/tools/extract_recording2.py"

The output is written to ``HKBK (2)/HKBK/output/recording2_frames`` unless a
different output directory is supplied with ``--output``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import time
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont, ImageStat


SAMPLE_FPS = 2.0
OUTPUT_MAX_WIDTH = 1920
JPEG_QUALITY = 3
MIN_SELECTED_GAP_SECONDS = 2.5
HASH_DISTANCE_THRESHOLD = 8
BLACK_MEAN_THRESHOLD = 8.0
BLUR_FLOOR = 18.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_text(command: list[str], *, cwd: Path | None = None) -> str:
    proc = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True,
                          encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(command)}\n{proc.stdout[-4000:]}")
    return proc.stdout


def ffmpeg_path() -> Path:
    candidates = [
        shutil.which("ffmpeg"),
        r"C:\Users\91701\AppData\Roaming\npm\ffmpeg.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    raise FileNotFoundError("ffmpeg.exe was not found on PATH or in the known npm tool location")


def parse_duration(value: str) -> float | None:
    duration_line = next((line for line in value.splitlines() if "Duration:" in line), value)
    match = re.search(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)", duration_line)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_fps(value: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:fps|tbr)", value)
    return float(match.group(1)) if match else None


def source_metadata(ffmpeg: Path, source: Path) -> dict[str, Any]:
    output = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-i", str(source)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace",
    ).stdout
    duration = parse_duration(output)
    video_line = next((line for line in output.splitlines() if "Video:" in line), "")
    dimension_match = re.search(r"(\d{2,5})x(\d{2,5})", video_line)
    dimensions = [int(dimension_match.group(i)) for i in (1, 2)] if dimension_match else [None, None]
    fps = parse_fps(video_line)
    rotation_match = re.search(r"rotation of (-?\d+)", output, re.IGNORECASE)
    return {
        "duration_seconds": duration,
        "width": dimensions[0],
        "height": dimensions[1],
        "frame_rate": fps,
        "video_stream_summary": video_line.strip(),
        "rotation_metadata": int(rotation_match.group(1)) if rotation_match else None,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def crc32_file(path: Path) -> str:
    value = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            value = zlib.crc32(block, value)
    return f"{value & 0xffffffff:08x}"


def average_hash(image: Image.Image, size: int = 16) -> int:
    gray = image.convert("L").resize((size, size), Image.Resampling.BILINEAR)
    pixels = list(gray.getdata())
    average = sum(pixels) / len(pixels)
    value = 0
    for pixel in pixels:
        value = (value << 1) | int(pixel >= average)
    return value


def hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def sharpness(image: Image.Image) -> float:
    # A small grayscale edge-energy estimate. It is intentionally a ranking
    # signal, not a hard claim about photographic quality.
    gray = image.convert("L").resize((320, 180), Image.Resampling.BILINEAR)
    pixels = list(gray.getdata())
    width, height = gray.size
    values: list[float] = []
    for y in range(1, height - 1):
        row = y * width
        for x in range(1, width - 1):
            center = pixels[row + x]
            lap = (pixels[row + x - 1] + pixels[row + x + 1] +
                   pixels[row - width + x] + pixels[row + width + x] - 4 * center)
            values.append(float(lap * lap))
    return sum(values) / len(values) if values else 0.0


def archive_evidence(archive: Path, member_name: str, source: Path) -> dict[str, Any]:
    if not archive.exists():
        return {"archive_path": str(archive), "archive_member": member_name, "archive_present": False}
    with zipfile.ZipFile(archive) as bundle:
        info = bundle.getinfo(member_name)
        local_size = source.stat().st_size
        local_crc = crc32_file(source)
        return {
            "archive_path": str(archive),
            "archive_member": member_name,
            "archive_present": True,
            "archive_member_size": info.file_size,
            "archive_member_crc32": f"{info.CRC:08x}",
            "local_size_matches_archive": local_size == info.file_size,
            "local_crc32": local_crc,
            "local_crc32_matches_archive": local_crc == f"{info.CRC:08x}",
        }


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def source_plan(source_dir: Path) -> tuple[list[tuple[str, Path, str]], list[dict[str, Any]]]:
    # big.MOV is the local safe filename for the archive's IMG_3887.MOV.
    expected: list[tuple[str, Path, str]] = []
    for number in range(3882, 3903):
        if number == 3886:
            continue
        filename = f"IMG_{number}.MOV"
        local = source_dir / ("big.MOV" if number == 3887 else filename)
        expected.append((filename, local, "Recording 2 original"))

    excluded = [
        {"filename": "Part1.mp4", "classification": "derived Recording 2 candidate excluded", "reason": "re-encoded derivative of big.MOV; not an independent original capture"},
        {"filename": "Part 2.mp4", "classification": "derived Recording 2 candidate excluded", "reason": "re-encoded derivative of big.MOV; not an independent original capture"},
        {"filename": "IMG_3886.MOV", "classification": "missing sequence number", "reason": "not present in Cllg 2 directory or Cllg 2.zip"},
    ]
    return expected, excluded


def extract_candidates(ffmpeg: Path, source: Path, destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    for old in destination.glob("candidate_*.jpg"):
        old.unlink()
    scale = f"fps={SAMPLE_FPS},scale=w='min({OUTPUT_MAX_WIDTH},iw)':h=-2:force_original_aspect_ratio=decrease"
    run_text([
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
        "-i", str(source), "-map", "0:v:0", "-vf", scale,
        "-q:v", str(JPEG_QUALITY), "-start_number", "1",
        str(destination / "candidate_%06d.jpg"),
    ])
    return sorted(destination.glob("candidate_*.jpg"))


def filter_candidates(paths: list[Path], source_row: dict[str, Any], selected_dir: Path) -> tuple[list[dict[str, Any]], list[Path]]:
    selected_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    selected: list[Path] = []
    last_selected_time = -math.inf
    last_hash: int | None = None
    duration = float(source_row.get("duration_seconds") or 0)
    fps = float(source_row.get("frame_rate") or 0)
    for position, candidate in enumerate(paths):
        timestamp = position / SAMPLE_FPS
        try:
            with Image.open(candidate) as image:
                image.load()
                mean = sum(ImageStat.Stat(image.convert("L")).mean) / 1.0
                score = sharpness(image)
                current_hash = average_hash(image)
                width, height = image.size
        except Exception as exc:  # keep a manifest entry for failed candidates
            rows.append({"candidate": candidate.name, "timestamp_seconds": round(timestamp, 3), "decision": "rejected", "reason": f"decode_error: {exc}", "sharpness_score": None, "mean_luma": None, "output": ""})
            continue

        reason = "selected"
        decision = "selected"
        if mean < BLACK_MEAN_THRESHOLD:
            decision, reason = "rejected", "near_black_frame"
        elif score < BLUR_FLOOR:
            decision, reason = "rejected", "low_edge_energy_possible_blur"
        elif timestamp - last_selected_time < MIN_SELECTED_GAP_SECONDS:
            decision, reason = "rejected", "minimum_temporal_gap"
        elif last_hash is not None and hamming(current_hash, last_hash) < HASH_DISTANCE_THRESHOLD:
            decision, reason = "rejected", "near_duplicate_average_hash"

        output_name = ""
        if decision == "selected":
            output_name = f"selected_{len(selected) + 1:04d}.jpg"
            target = selected_dir / output_name
            shutil.copy2(candidate, target)
            selected.append(target)
            last_selected_time = timestamp
            last_hash = current_hash

        rows.append({
            "candidate": candidate.name,
            "timestamp_seconds": round(timestamp, 3),
            "source_frame_approx": round(timestamp * fps) if fps else None,
            "width": width,
            "height": height,
            "sharpness_score": round(score, 3),
            "mean_luma": round(mean, 3),
            "decision": decision,
            "reason": reason,
            "output": output_name,
            "duration_seconds": duration,
        })
    return rows, selected


def representative_contact_sheet(selected_rows: list[dict[str, Any]], output_root: Path, output: Path) -> None:
    if not selected_rows:
        return
    count = min(40, len(selected_rows))
    indexes = [round(i * (len(selected_rows) - 1) / max(1, count - 1)) for i in range(count)]
    chosen = [selected_rows[i] for i in indexes]
    cell_w, image_h, caption_h = 320, 180, 34
    columns = 5
    rows = math.ceil(len(chosen) / columns)
    sheet = Image.new("RGB", (columns * cell_w, rows * (image_h + caption_h)), "#101317")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, row in enumerate(chosen):
        path = output_root / row["output"]
        with Image.open(path) as image:
            image = image.convert("RGB")
            image.thumbnail((cell_w, image_h), Image.Resampling.LANCZOS)
            x = (index % columns) * cell_w + (cell_w - image.width) // 2
            y = (index // columns) * (image_h + caption_h)
            sheet.paste(image, (x, y))
        caption = f"{row['source_clip']}  t={row['timestamp_seconds']:.1f}s"
        draw.text(((index % columns) * cell_w + 5, y + image_h + 5), caption, fill="#f3f0e8", font=font)
    sheet.save(output, "JPEG", quality=90, optimize=True)


def validate(output: Path, manifest_rows: list[dict[str, Any]]) -> dict[str, Any]:
    selected = [row for row in manifest_rows if row["decision"] == "selected"]
    missing = []
    corrupt = []
    dimensions_invalid = []
    per_source: dict[str, int] = {}
    previous: dict[str, float] = {}
    ordering_errors = []
    for row in selected:
        path = output / row["output"]
        if not path.exists():
            missing.append(row["output"])
            continue
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                if image.width <= 0 or image.height <= 0:
                    dimensions_invalid.append(row["output"])
        except Exception as exc:
            corrupt.append({"path": row["output"], "error": str(exc)})
        clip = row["source_clip"]
        timestamp = float(row["timestamp_seconds"])
        if clip in previous and timestamp < previous[clip]:
            ordering_errors.append({"source_clip": clip, "previous": previous[clip], "current": timestamp})
        previous[clip] = timestamp
        per_source[clip] = per_source.get(clip, 0) + 1
    return {
        "selected_manifest_entries": len(selected),
        "missing_images": missing,
        "corrupt_images": corrupt,
        "invalid_dimensions": dimensions_invalid,
        "ordering_errors": ordering_errors,
        "per_source_selected_counts": per_source,
        "all_selected_images_valid": not (missing or corrupt or dimensions_invalid),
        "chronology_valid": not ordering_errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--discard-candidates", action="store_true", help="delete candidate images after filtering; by default they are retained as a deliverable")
    args = parser.parse_args()

    script = Path(__file__).resolve()
    project_root = script.parents[1]
    workspace_root = project_root.parents[1]
    source_dir = (args.source_dir or workspace_root / "Cllg 2").resolve()
    output = (args.output or project_root / "output" / "recording2_frames").resolve()
    archive = workspace_root / "Cllg 2.zip"
    output.mkdir(parents=True, exist_ok=True)
    candidates_root = output / "candidates"
    selected_root = output / "selected"
    # This directory is owned by this isolated pipeline. Clearing only these
    # generated subdirectories makes reruns reproducible without touching any
    # source video, website asset, or existing tour frame.
    shutil.rmtree(candidates_root, ignore_errors=True)
    shutil.rmtree(selected_root, ignore_errors=True)
    selected_root.mkdir(exist_ok=True)
    ffmpeg = ffmpeg_path()
    started = utc_now()

    expected, exclusions = source_plan(source_dir)
    source_rows: list[dict[str, Any]] = []
    for archive_member, source, classification in expected:
        row: dict[str, Any] = {
            "classification": classification,
            "archive_member": archive_member,
            "source_path": str(source),
            "source_filename": source.name,
            "exists": source.exists(),
        }
        if source.exists():
            row.update(source_metadata(ffmpeg, source))
            row["size_bytes"] = source.stat().st_size
            row["sha256"] = sha256_file(source)
            row.update(archive_evidence(archive, archive_member, source))
        source_rows.append(row)

    missing_sources = [row for row in source_rows if not row["exists"]]
    if missing_sources:
        raise RuntimeError("Required Recording 2 source(s) are missing: " + ", ".join(row["archive_member"] for row in missing_sources))
    if not all(row.get("local_crc32_matches_archive", False) for row in source_rows):
        raise RuntimeError("At least one selected source failed the Cllg 2.zip size/CRC provenance check")

    inventory_rows = source_rows + [{"classification": item["classification"], "source_filename": item["filename"], "reason": item["reason"], "exists": (source_dir / item["filename"]).exists()} for item in exclusions]
    write_csv(output / "source_inventory.csv", inventory_rows, [
        "classification", "archive_member", "source_path", "source_filename", "exists", "size_bytes", "duration_seconds", "width", "height", "frame_rate", "rotation_metadata", "sha256", "archive_path", "archive_present", "archive_member_size", "archive_member_crc32", "local_size_matches_archive", "local_crc32", "local_crc32_matches_archive", "reason",
    ])
    (output / "source_inventory.json").write_text(json.dumps({"recording": "Recording 2", "capture_date": "2026-08-22", "selected_sources": source_rows, "exclusions": exclusions}, indent=2), encoding="utf-8")

    manifest_rows: list[dict[str, Any]] = []
    sequence = 0
    source_summaries = []
    for source_row in source_rows:
        source_name = source_row["archive_member"].replace(".MOV", "").replace(".", "_")
        candidate_dir = candidates_root / source_name
        selected_dir = selected_root / source_name
        candidates = extract_candidates(ffmpeg, Path(source_row["source_path"]), candidate_dir)
        decisions, selected = filter_candidates(candidates, source_row, selected_dir)
        for decision in decisions:
            sequence += 1
            decision.update({
                "sequence_index": sequence,
                "frame_id": f"rec2_{sequence:05d}",
                "source_recording": "Recording 2",
                "source_clip": source_row["archive_member"],
                "source_relative_path": source_row["archive_member"],
                "source_duration_seconds": source_row["duration_seconds"],
                "source_frame_rate": source_row["frame_rate"],
                "extraction_timestamp_utc": started,
                "sampling_fps": SAMPLE_FPS,
                "jpeg_quality": JPEG_QUALITY,
                "max_output_width": OUTPUT_MAX_WIDTH,
                "candidate_path": f"candidates/{source_name}/{decision['candidate']}",
                "output": f"selected/{source_name}/{decision['output']}" if decision["output"] else "",
            })
            manifest_rows.append(decision)
        source_summaries.append({"source_clip": source_row["archive_member"], "candidate_count": len(candidates), "selected_count": len(selected), "rejected_count": len(candidates) - len(selected)})
        if args.discard_candidates:
            shutil.rmtree(candidate_dir, ignore_errors=True)

    selected_rows = [row for row in manifest_rows if row["decision"] == "selected"]
    write_csv(output / "extraction_manifest.csv", manifest_rows, list(manifest_rows[0].keys()) if manifest_rows else ["frame_id"])
    (output / "extraction_manifest.json").write_text(json.dumps({"recording": "Recording 2", "rows": manifest_rows}, indent=2), encoding="utf-8")
    representative_contact_sheet(selected_rows, output, output / "contact_sheet_selected.jpg")
    checks = validate(output, manifest_rows)
    total_bytes = sum(path.stat().st_size for path in (output / "selected").rglob("*.jpg"))
    report = {
        "recording": "Recording 2",
        "source_verification": "20 August 22, 2026 originals from Cllg 2.zip; IMG_3887.MOV is locally named big.MOV and matched by archive size/CRC32",
        "excluded": exclusions,
        "settings": {"candidate_sampling_fps": SAMPLE_FPS, "max_output_width": OUTPUT_MAX_WIDTH, "jpeg_quality": JPEG_QUALITY, "filter": {"min_selected_gap_seconds": MIN_SELECTED_GAP_SECONDS, "hash_distance_threshold": HASH_DISTANCE_THRESHOLD, "black_mean_threshold": BLACK_MEAN_THRESHOLD, "blur_floor": BLUR_FLOOR}},
        "counts": {"source_count": len(source_rows), "candidate_count": len(manifest_rows), "selected_count": len(selected_rows), "rejected_count": len(manifest_rows) - len(selected_rows), "selected_disk_bytes": total_bytes, "per_source": source_summaries},
        "validation": checks,
        "artifacts": {"script": str(script.relative_to(project_root)), "inventory_csv": "output/recording2_frames/source_inventory.csv", "inventory_json": "output/recording2_frames/source_inventory.json", "manifest_csv": "output/recording2_frames/extraction_manifest.csv", "manifest_json": "output/recording2_frames/extraction_manifest.json", "selected_frames": "output/recording2_frames/selected/", "contact_sheet": "output/recording2_frames/contact_sheet_selected.jpg"},
        "integration_status": "Existing website files, assets/tour-photos/f0001.jpg-f0125.jpg, and the existing tour manifest were not modified.",
        "generated_at_utc": utc_now(),
    }
    (output / "extraction_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    markdown = [
        "# Recording 2 frame extraction report", "", "## Source verification", report["source_verification"],
        "", "## Settings", f"- Candidate sampling: {SAMPLE_FPS:g} fps\n- Maximum output width: {OUTPUT_MAX_WIDTH}px\n- JPEG quality: FFmpeg `-q:v {JPEG_QUALITY}`\n- Filtering: sharpness/luma gate, minimum temporal gap, and average-hash near-duplicate check.",
        "", "## Results", f"- Sources processed: {len(source_rows)}\n- Candidates: {len(manifest_rows)}\n- Selected frames: {len(selected_rows)}\n- Rejected candidates: {len(manifest_rows) - len(selected_rows)}\n- Selected output size: {total_bytes:,} bytes",
        "", "## Per-source counts", "| Source | Candidates | Selected | Rejected |\n|---|---:|---:|---:|", *[f"| {s['source_clip']} | {s['candidate_count']} | {s['selected_count']} | {s['rejected_count']} |" for s in source_summaries],
        "", "## Validation", f"- All selected images valid: **{checks['all_selected_images_valid']}**\n- Chronology valid within each clip: **{checks['chronology_valid']}**\n- Missing selected images: {len(checks['missing_images'])}\n- Corrupt selected images: {len(checks['corrupt_images'])}\n- Invalid dimensions: {len(checks['invalid_dimensions'])}",
        "", "## Artifacts", "- `tools/extract_recording2.py`\n- `output/recording2_frames/source_inventory.csv` and `.json`\n- `output/recording2_frames/extraction_manifest.csv` and `.json`\n- `output/recording2_frames/selected/`\n- `output/recording2_frames/contact_sheet_selected.jpg`\n- `output/recording2_frames/extraction_report.json`",
        "", "## Exclusions and limitations", "- `IMG_3886.MOV` was absent from both the source directory and archive.\n- `Part1.mp4` and `Part 2.mp4` were excluded as re-encoded derivatives of the long `IMG_3887.MOV` source, not independent captures.\n- Source-clip boundaries are retained; the output does not claim spatial continuity between clips.\n- Existing website files and the existing 125-frame walkthrough were left unchanged.",
    ]
    (output / "extraction_report.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "sources": len(source_rows), "candidates": len(manifest_rows), "selected": len(selected_rows), "rejected": len(manifest_rows) - len(selected_rows), "selected_bytes": total_bytes, "validation": checks}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
