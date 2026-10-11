# HKBK Campus Explorer - important files package

Includes the landing pages, offline college enquiry chatbot, both photo walkthroughs, local Three.js libraries, available 3D assets, tools, tests, documentation, and Recording 2 extraction records.

## Preview
Open a terminal in this extracted folder and run:

    python -m http.server 8774 --bind 127.0.0.1

Open http://127.0.0.1:8774/demo.html for the explorer landing page.
Open http://127.0.0.1:8774/index.html for the college site and chatbot.
Open http://127.0.0.1:8774/street-view.html for the preserved original 125-frame walkthrough.
Open http://127.0.0.1:8774/recording2-walkthrough.html for the independent 211-frame Recording 2 route.
Open http://127.0.0.1:8774/campus.html for the partial 3D preview.

The chatbot performs local fuzzy matching and TF-IDF retrieval. No active LLM or neural embedding service is connected.
The 3D preview includes main-block.glb; other buildings may use procedural placeholders. It is not a complete digital twin.
Recording 2 image quality remains under review. Both walkthrough datasets are preserved as supplied.

## Excluded
Original Cllg 2 videos and Cllg 2.zip; raw recording folders; duplicate selected/candidate extraction images; backup archives; caches; editor configuration; reconstruction databases and notebooks.
The curated assets/video clips are included because index.html uses them.

Keep the original Recording 2 source folder and ZIP separately for future re-extraction. Extraction tools retain their original workspace path assumptions and require those sources, the provenance archive, FFmpeg, and Pillow. This package alone cannot rerun source-video extraction.

PACKAGE_README.md describes this archive. Older project notes remain included for context and may describe historical behavior.
