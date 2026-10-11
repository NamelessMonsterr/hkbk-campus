#!/usr/bin/env python3
"""Build the isolated Recording 2 photo route dataset.

This builder consumes only the already-reviewed extraction outputs in
``output/recording2_frames``.  It copies selected JPEG bytes into the isolated
``assets/tour-photos-recording2`` directory and never touches the existing
``assets/tour-photos`` dataset, website files, source videos, or extraction
inputs.

The source order is the order in ``source_inventory.json``.  Timestamps remain
clip-local candidate sampling times; they are not presented as exact source
PTS values or as evidence of spatial continuity between clips.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import zipfile
import zlib
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont, ImageOps


EXPECTED_SELECTED = 211
EXPECTED_SOURCES = 20
TIMESTAMP_BASIS = "candidate sampling time; approximate source PTS"

CHAPTERS: tuple[dict[str, Any], ...] = (
    {
        "id": "gate-front-approach",
        "label": "Gate and front approach",
        "clips": ("IMG_3882.MOV", "IMG_3883.MOV", "IMG_3884.MOV", "IMG_3885.MOV"),
    },
    {
        "id": "entrance-interiors-campus-lanes",
        "label": "Entrance, interiors and campus lanes",
        "clips": ("IMG_3887.MOV",),
    },
    {
        "id": "building-entrances-tree-lined-lanes",
        "label": "Building entrances and tree-lined lanes",
        "clips": ("IMG_3888.MOV", "IMG_3889.MOV", "IMG_3890.MOV", "IMG_3891.MOV", "IMG_3892.MOV", "IMG_3893.MOV"),
    },
    {
        "id": "covered-spaces-outer-lanes",
        "label": "Covered spaces and outer lanes",
        "clips": ("IMG_3894.MOV", "IMG_3895.MOV", "IMG_3896.MOV", "IMG_3897.MOV", "IMG_3898.MOV", "IMG_3899.MOV"),
    },
    {
        "id": "rotated-final-passages",
        "label": "Rotated view and final building passages",
        "clips": ("IMG_3900.MOV", "IMG_3901.MOV", "IMG_3902.MOV"),
    },
)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required input is missing: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON input {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected a JSON object at {path}")
    return value


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def ensure_relative(path_value: str, *, field: str) -> Path:
    path = Path(path_value)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeError(f"Unsafe {field} path in extraction input: {path_value!r}")
    return path


def relative_to(path: Path, root: Path) -> Path:
    try:
        return path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise RuntimeError(f"Path escapes expected root {root}: {path}") from exc


def install_exact_bytes(path: Path, data: bytes) -> str:
    """Install bytes without replacing a divergent existing file."""
    if path.exists():
        if not path.is_file():
            raise RuntimeError(f"Refusing to replace non-file output: {path}")
        existing = path.read_bytes()
        if existing != data:
            raise RuntimeError(f"Refusing to overwrite divergent existing file: {path}")
        return "existing"

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise
    return "created"


def install_exact_copy(source: Path, destination: Path) -> str:
    """Copy source bytes exactly, refusing a divergent destination."""
    if destination.exists():
        if not destination.is_file():
            raise RuntimeError(f"Refusing to replace non-file output: {destination}")
        if source.stat().st_size != destination.stat().st_size or sha256_file(source) != sha256_file(destination):
            raise RuntimeError(f"Refusing to overwrite divergent existing file: {destination}")
        return "existing"

    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as output_handle, source.open("rb") as source_handle:
            shutil.copyfileobj(source_handle, output_handle, length=8 * 1024 * 1024)
            output_handle.flush()
            os.fsync(output_handle.fileno())
        os.replace(temporary, destination)
    except Exception:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise
    return "created"


def verify_inventory(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    sources = inventory.get("selected_sources")
    if not isinstance(sources, list) or len(sources) != EXPECTED_SOURCES:
        raise RuntimeError(f"source_inventory.json must contain {EXPECTED_SOURCES} selected_sources")

    archive_paths: set[Path] = set()
    members: list[dict[str, Any]] = []
    for index, row in enumerate(sources, start=1):
        if not isinstance(row, dict):
            raise RuntimeError(f"source_inventory selected_sources[{index}] is not an object")
        for field in ("archive_member", "source_path", "archive_path", "archive_member_size", "archive_member_crc32", "local_size_matches_archive", "local_crc32_matches_archive"):
            if field not in row:
                raise RuntimeError(f"source_inventory row {index} lacks {field!r}")
        if row.get("classification") != "Recording 2 original":
            raise RuntimeError(f"Unexpected source classification at inventory row {index}")
        if not row["local_size_matches_archive"] or not row["local_crc32_matches_archive"]:
            raise RuntimeError(f"Inventory provenance flags are not true for {row['archive_member']}")

        source = Path(row["source_path"])
        archive = Path(row["archive_path"])
        if not source.is_file():
            raise RuntimeError(f"Inventory source is missing: {source}")
        if not archive.is_file():
            raise RuntimeError(f"Inventory archive is missing: {archive}")
        archive_paths.add(archive.resolve())
        local_size = source.stat().st_size
        local_crc = crc32_file(source)
        if local_size != int(row["archive_member_size"]):
            raise RuntimeError(f"Local size does not match inventory for {row['archive_member']}")
        if local_crc != str(row["archive_member_crc32"]).lower() or local_crc != str(row.get("local_crc32", "")).lower():
            raise RuntimeError(f"Local CRC32 does not match inventory for {row['archive_member']}")

        with zipfile.ZipFile(archive) as bundle:
            try:
                archive_info = bundle.getinfo(row["archive_member"])
            except KeyError as exc:
                raise RuntimeError(f"Archive member is missing: {row['archive_member']}") from exc
            archive_crc = f"{archive_info.CRC:08x}"
            if archive_info.file_size != local_size or archive_crc != local_crc:
                raise RuntimeError(f"Archive size/CRC verification failed for {row['archive_member']}")
            if archive_info.file_size != int(row["archive_member_size"]) or archive_crc != str(row["archive_member_crc32"]).lower():
                raise RuntimeError(f"Inventory archive evidence is stale for {row['archive_member']}")
        members.append(row)

    if len(archive_paths) != 1:
        raise RuntimeError("Recording 2 inventory points at more than one archive")
    return members


def validate_extraction_rows(extraction: dict[str, Any], sources: list[dict[str, Any]], extraction_root: Path) -> list[dict[str, Any]]:
    rows = extraction.get("rows")
    if not isinstance(rows, list):
        raise RuntimeError("extraction_manifest.json lacks a rows list")
    selected = [row for row in rows if isinstance(row, dict) and row.get("decision") == "selected"]
    if len(selected) != EXPECTED_SELECTED:
        raise RuntimeError(f"Expected {EXPECTED_SELECTED} selected extraction rows, found {len(selected)}")

    source_order = [row["archive_member"] for row in sources]
    order_index = {name: index for index, name in enumerate(source_order)}
    previous_sequence = -1
    previous_clip_index = -1
    previous_t: dict[str, float] = {}
    for row in selected:
        clip = row.get("source_clip")
        if clip not in order_index:
            raise RuntimeError(f"Selected row references a source outside inventory order: {clip!r}")
        sequence = row.get("sequence_index")
        if not isinstance(sequence, int) or sequence <= previous_sequence:
            raise RuntimeError("Selected rows are not in strictly ascending extraction sequence_index order")
        previous_sequence = sequence
        clip_index = order_index[clip]
        if clip_index < previous_clip_index:
            raise RuntimeError("Selected rows do not preserve source_inventory order")
        previous_clip_index = clip_index
        timestamp = row.get("timestamp_seconds")
        if not isinstance(timestamp, (int, float)):
            raise RuntimeError(f"Selected row has no numeric timestamp: {row.get('frame_id')}")
        timestamp = float(timestamp)
        if clip in previous_t and timestamp <= previous_t[clip]:
            raise RuntimeError(f"Selected timestamps are not ascending within {clip}")
        previous_t[clip] = timestamp

        output_value = row.get("output")
        candidate_value = row.get("candidate_path")
        output_rel = ensure_relative(str(output_value), field="selected output")
        candidate_rel = ensure_relative(str(candidate_value), field="candidate")
        if not output_rel.parts or output_rel.parts[0].lower() != "selected":
            raise RuntimeError(f"Selected row does not point into selected/: {output_value!r}")
        if not candidate_rel.parts or candidate_rel.parts[0].lower() != "candidates":
            raise RuntimeError(f"Selected row has an unexpected candidate path: {candidate_value!r}")
        # Deliberately resolve only the selected output. Candidate files are
        # provenance inputs and are never eligible as route-frame sources.
        selected_path = extraction_root / output_rel
        if not selected_path.is_file():
            raise RuntimeError(f"Selected JPEG is missing: {selected_path}")
        with Image.open(selected_path) as image:
            image.verify()
        with Image.open(selected_path) as image:
            image.load()
            if image.size != (int(row["width"]), int(row["height"])):
                raise RuntimeError(f"Selected JPEG dimensions disagree with extraction row: {selected_path}")
        row["_selected_path"] = selected_path
        row["_selected_sha256"] = sha256_file(selected_path)

    if previous_clip_index != len(source_order) - 1:
        raise RuntimeError("Selected rows do not cover the final source in inventory order")
    return selected


def selected_by_clip(selected: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in selected:
        grouped[str(row["source_clip"])].append(row)
    return dict(grouped)


def build_frames(selected: list[dict[str, Any]], destination: Path) -> tuple[list[dict[str, Any]], dict[str, tuple[int, int]]]:
    frames: list[dict[str, Any]] = []
    clip_ranges: dict[str, tuple[int, int]] = {}
    for output_index, row in enumerate(selected, start=1):
        filename = f"f{output_index:04d}.jpg"
        clip = str(row["source_clip"])
        first_for_clip = clip not in clip_ranges
        frame = {
            "file": filename,
            "clip": clip,
            "t": float(row["timestamp_seconds"]),
            "frame_id": str(row["frame_id"]),
            "source_relative_path": str(row["source_relative_path"]),
            "archive_member": clip,
            "extraction_frame_id": str(row["candidate"]),
            "source_frame_approx": row.get("source_frame_approx"),
            "timestamp_basis": TIMESTAMP_BASIS,
            "width": int(row["width"]),
            "height": int(row["height"]),
            "sha256": str(row["_selected_sha256"]),
            "clip_start": first_for_clip,
            "sequence_index": int(row["sequence_index"]),
        }
        frames.append(frame)
        if first_for_clip:
            clip_ranges[clip] = (output_index, output_index)
        else:
            clip_ranges[clip] = (clip_ranges[clip][0], output_index)

        destination_path = destination / filename
        # Preflight all exact-copy destinations before any output is installed.
        if destination_path.exists() and (destination_path.stat().st_size != row["_selected_path"].stat().st_size or sha256_file(destination_path) != frame["sha256"]):
            raise RuntimeError(f"Refusing to overwrite divergent existing file: {destination_path}")
    return frames, clip_ranges


def make_contact_sheet(selected: list[dict[str, Any]], output: Path) -> bytes:
    grouped = selected_by_clip(selected)
    ordered_clips: list[str] = []
    seen_clips: set[str] = set()
    for row in selected:
        clip = str(row["source_clip"])
        if clip not in seen_clips:
            seen_clips.add(clip)
            ordered_clips.append(clip)
    # First appearance preserves the verified inventory/source order; avoid
    # sorting filenames as that would hide gaps.
    tiles: list[tuple[str, str, Path, float]] = []
    for clip in ordered_clips:
        rows = grouped[clip]
        midpoint = min(rows, key=lambda row: abs(float(row["timestamp_seconds"]) - float(rows[-1]["timestamp_seconds"]) / 2.0))
        chosen = (rows[0], midpoint, rows[-1])
        for label, row in zip(("first", "middle", "last"), chosen):
            tiles.append((clip, label, Path(row["_selected_path"]), float(row["timestamp_seconds"])))

    columns = 4
    cell_width, image_height, caption_height = 360, 240, 34
    rows_count = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows_count * (image_height + caption_height)), "#101317")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (clip, label, source, timestamp) in enumerate(tiles):
        x = (index % columns) * cell_width
        y = (index // columns) * (image_height + caption_height)
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image = ImageOps.contain(image, (cell_width - 16, image_height - 16), Image.Resampling.LANCZOS)
        sheet.paste(image, (x + (cell_width - image.width) // 2, y + (image_height - image.height) // 2))
        draw.text((x + 5, y + image_height + 5), f"{clip} | {label} | t={timestamp:.3f}s", fill="#f3f0e8", font=font)

    buffer = io.BytesIO()
    sheet.save(buffer, format="JPEG", quality=90, optimize=True)
    return buffer.getvalue()


def build_clips(
    sources: list[dict[str, Any]],
    grouped: dict[str, list[dict[str, Any]]],
    clip_ranges: dict[str, tuple[int, int]],
) -> list[dict[str, Any]]:
    clips: list[dict[str, Any]] = []
    for source in sources:
        filename = str(source["archive_member"])
        rows = grouped.get(filename)
        if not rows:
            raise RuntimeError(f"No selected frames for inventory source {filename}")
        start, end = clip_ranges[filename]
        clips.append(
            {
                "filename": filename,
                "start": start,
                "end": end,
                "boundary_note": (
                    "Explicit source-clip boundary; timestamps are clip-local and reset at 0.0. "
                    "Continuity with neighboring clips is unverified."
                ),
                "duration_seconds": float(source["duration_seconds"]),
                "start_t": float(rows[0]["timestamp_seconds"]),
                "end_t": float(rows[-1]["timestamp_seconds"]),
                "selected_count": len(rows),
            }
        )
    return clips


def build_chapters(clip_ranges: dict[str, tuple[int, int]]) -> list[dict[str, Any]]:
    chapters: list[dict[str, Any]] = []
    for chapter in CHAPTERS:
        missing = [clip for clip in chapter["clips"] if clip not in clip_ranges]
        if missing:
            raise RuntimeError(f"Chapter {chapter['id']} lacks selected clip(s): {', '.join(missing)}")
        start = clip_ranges[chapter["clips"][0]][0]
        end = clip_ranges[chapter["clips"][-1]][1]
        chapters.append(
            {
                "id": chapter["id"],
                "label": chapter["label"],
                "start": start,
                "end": end,
                "clip_filenames": list(chapter["clips"]),
                "boundary_note": "Chapter grouping is grounded in the reviewed contact sheet; each listed clip retains an explicit boundary.",
            }
        )
    return chapters


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def build_readme(
    sources: list[dict[str, Any]],
    selected: list[dict[str, Any]],
    frames: list[dict[str, Any]],
    clips: list[dict[str, Any]],
    chapters: list[dict[str, Any]],
    candidate_count: int,
) -> str:
    source_names = [str(source["archive_member"]) for source in sources]
    lines = [
        "# Recording 2 isolated route dataset",
        "",
        "This directory is an isolated, additive dataset. It does not replace or modify the existing 125-frame `assets/tour-photos/` route.",
        "",
        "## Verified build",
        "",
        f"- Originals retained: **{len(sources)}** (inventory order).",
        f"- Extraction candidates: **{candidate_count}**; selected **{len(selected)}**; rejected **{candidate_count - len(selected)}**.",
        f"- Selected route JPEGs: **{len(selected)}**, written as `f0001.jpg` through `f{len(selected):04d}.jpg`.",
        "- Selection source: rows with `decision: \"selected\"` only from `output/recording2_frames/extraction_manifest.json`; rejected candidates are never used as replacements.",
        "- Every route JPEG is an exact byte copy of its selected extraction JPEG; the manifest records its SHA-256 and decoded dimensions.",
        "- Archive provenance was rechecked against `output/recording2_frames/source_inventory.json`: local size and CRC32 match the corresponding `Cllg 2.zip` member for all 20 originals.",
        "- `IMG_3887.MOV` is the archive/original name; its local source filename is `big.MOV`.",
        "",
        "## Chapters",
        "",
        "Chapter `start` and `end` values are 1-based route-frame indexes, matching the existing tour manifest convention.",
        "",
        "| ID | Label | Frames | Clips |",
        "|---|---|---:|---|",
    ]
    for chapter in chapters:
        lines.append(f"| `{chapter['id']}` | {chapter['label']} | {chapter['start']}–{chapter['end']} | {', '.join(chapter['clip_filenames'])} |")

    lines += [
        "",
        "## Clip starts, boundaries, and gaps",
        "",
        "Clip `start` and `end` values are also 1-based route-frame indexes. Each frame has clip-local `t` seconds; `clip_start` is `true` only on the first selected frame of each source clip. The supplemental `start_t`/`end_t` values describe the selected range inside each source clip.",
        "",
        "| Clip | Frames | Selected t range | Duration (s) |",
        "|---|---:|---:|---:|",
    ]
    for clip in clips:
        lines.append(f"| {clip['filename']} | {clip['start']}–{clip['end']} | {clip['start_t']:.3f}–{clip['end_t']:.3f} | {clip['duration_seconds']:.2f} |")

    lines += [
        "",
        "The 2 fps candidate sampling and filtering leave temporal gaps between selected frames inside a clip. Timestamps reset at every clip boundary; there is no verified continuous route time across clips. `IMG_3886.MOV` is missing from both the source directory and archive, so the source-order gap between `IMG_3885.MOV` and `IMG_3887.MOV` is retained. The filenames establish inventory/source order only; they do not prove spatial continuity.",
        "",
        "## Metadata and limitations",
        "",
        f"- `manifest.json` contains {len(frames)} frames, {len(chapters)} contact-sheet-grounded chapters, and {len(clips)} explicit source-clip boundaries.",
        f"- Frame `t` uses `{TIMESTAMP_BASIS}`.",
        "- `source_frame_approx` is an extraction estimate from the source frame rate, not a decoded presentation timestamp.",
        "- Capture date is present in the inventory as 2026-08-22; a verified capture time is not available, so `capture_time` is intentionally omitted from clip records.",
        "- The contact sheet contains first/middle/last selected views for every original clip, labelled with original filename and sampling time, using aspect-preserving containment (no crop/stretch).",
        "- Builder reruns are safe: identical existing files are retained, divergent expected files cause an error, and extra files are never deleted.",
        "",
        "Source order used:",
        "",
        ", ".join(source_names),
        "",
    ]
    return "\n".join(lines)


def build(args: argparse.Namespace) -> dict[str, Any]:
    project_root = Path(__file__).resolve().parents[1]
    extraction_root = (args.extraction_root or project_root / "output" / "recording2_frames").resolve()
    destination = (args.destination or project_root / "assets" / "tour-photos-recording2").resolve()
    inventory_path = extraction_root / "source_inventory.json"
    extraction_manifest_path = extraction_root / "extraction_manifest.json"

    inventory = load_json(inventory_path)
    sources = verify_inventory(inventory)
    extraction = load_json(extraction_manifest_path)
    selected = validate_extraction_rows(extraction, sources, extraction_root)

    destination.mkdir(parents=True, exist_ok=True)
    frames, clip_ranges = build_frames(selected, destination)
    grouped = selected_by_clip(selected)
    clips = build_clips(sources, grouped, clip_ranges)
    chapters = build_chapters(clip_ranges)

    manifest = {
        "recording": "Recording 2",
        "count": len(frames),
        "source_order": [str(source["archive_member"]) for source in sources],
        "frames": frames,
        "chapters": chapters,
        "clips": clips,
    }
    manifest_data = json_bytes(manifest)
    contact_sheet_data = make_contact_sheet(selected, destination / "contact-sheet.jpg")
    readme_data = build_readme(sources, selected, frames, clips, chapters, len(extraction.get("rows", []))).encode("utf-8")

    # Preflight metadata files before installing any missing JPEGs. A rerun
    # therefore cannot partially update this dataset before discovering drift.
    for path, data in (
        (destination / "manifest.json", manifest_data),
        (destination / "contact-sheet.jpg", contact_sheet_data),
        (destination / "README.md", readme_data),
    ):
        if path.exists() and path.read_bytes() != data:
            raise RuntimeError(f"Refusing to overwrite divergent existing file: {path}")

    created = 0
    existing = 0
    for row, frame in zip(selected, frames):
        result = install_exact_copy(Path(row["_selected_path"]), destination / frame["file"])
        if result == "created":
            created += 1
        else:
            existing += 1
    install_exact_bytes(destination / "manifest.json", manifest_data)
    install_exact_bytes(destination / "contact-sheet.jpg", contact_sheet_data)
    install_exact_bytes(destination / "README.md", readme_data)

    return {
        "destination": str(destination),
        "sources": len(sources),
        "selected": len(selected),
        "frames_created": created,
        "frames_existing": existing,
        "chapters": len(chapters),
        "clips": len(clips),
        "first_frame": frames[0]["file"],
        "last_frame": frames[-1]["file"],
        "chapter_ranges": [{"id": chapter["id"], "start": chapter["start"], "end": chapter["end"]} for chapter in chapters],
        "clip_ranges": [{"filename": clip["filename"], "start": clip["start"], "end": clip["end"]} for clip in clips],
        "archive_crc_size_verified": True,
        "selected_only": True,
        "contact_sheet_tiles": len(clips) * 3,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extraction-root", type=Path, default=None, help="recording2_frames input directory")
    parser.add_argument("--destination", type=Path, default=None, help="isolated route output directory")
    args = parser.parse_args()
    result = build(args)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
