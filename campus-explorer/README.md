# HKBK College of Engineering — landing page with enquiry assistant

A single-page college website with a retrieval-based enquiry assistant built into
it. Implements the approach described in *Intelligent Chatbot For College Inquiry
And Support: Using Fuzzy Matching And LLM* (Dept. of CSE, HKBK College of
Engineering).

## Running it

Double-click `index.html`. That is the whole procedure.

No build step, no `npm install`, no server, no internet connection, no API key.
Everything runs in the browser from local files, which is why the knowledge base
is shipped twice (see below).

`campus.html` is the exception: it's an interactive 3D campus explorer that
loads real Three.js addons (GLTFLoader, Draco, bloom, SSAO) as ES modules from
a CDN, which browsers block on `file://`. Serve the folder instead:

```
python3 -m http.server 8000     # or: npx serve .
```

then open `http://localhost:8000/campus.html`. It needs an internet
connection (for the CDN modules) the first time you load it; `index.html`
itself still needs neither a server nor internet.

Running the tests needs Node:

```
cd hkbk
node tests/engine-test.js
```

49 assertions, all expected to pass.

## Layout

```
index.html                  the page, plus a short boot script at the bottom
css/main.css                all styling — dark theme, hex motif, chatbot styles
js/vendor/three.min.js      Three.js r140, vendored (see js/vendor/README.txt)
js/3d/webgl-support.js      feature-detect + shared helpers for the 3D scenes
js/3d/hero-scene.js         hero hex-tunnel WebGL scene
js/3d/gallery-scene.js      campus hex-crystal WebGL scene
js/3d/transition-scene.js   About → Courses portal WebGL scene
js/chatbot-engine.js        retrieval, fuzzy matching, memory, refusal logic
js/chatbot-ui.js            rendering only — no decisions about what to say
data/knowledge-base.json    the source of truth: 32 entries and all figures
data/knowledge-base.js      generated from the JSON, loaded by the page
tests/engine-test.js        49 assertions over the engine
assets/images/              photographs taken on campus (see Photographs below)
assets/video/                curated short campus clips, muted/looping
docs/implementation-notes.md every deviation from the paper, written down
```

### Why the knowledge base exists twice

`knowledge-base.json` is the file you edit. `knowledge-base.js` is generated from
it and wraps the same data in `window.HKBK_KB`.

The reason is `file://`. When the page is opened by double-clicking, Chrome
blocks `fetch()` of a local JSON file as a cross-origin request, so the JSON
cannot be loaded the normal way. A `<script>` tag is not subject to that rule.

After editing the JSON, regenerate:

```
python3 -c "import json;d=json.load(open('data/knowledge-base.json',encoding='utf-8'));open('data/knowledge-base.js','w',encoding='utf-8').write('window.HKBK_KB = '+json.dumps(d,ensure_ascii=False,indent=1)+';\n')"
```

## How the assistant answers

1. **Language identification** by script range, before anything else.
2. **Normalise and tokenise** the query.
3. **TF-IDF retrieval** over 512-token chunks with 64-token overlap, ranked by
   cosine similarity, top 5 kept.
4. **Fuzzy repair** of unmatched words using Levenshtein similarity at a 0.78
   threshold, so `hostal fes` still reaches the hostel fee entry.
5. **Confidence floor.** Below 0.17 the assistant refuses and hands over phone
   numbers instead of answering. This is the one thing the paper listed as future
   work rather than implemented.
6. **Token resolution.** Figures such as the hostel fee live in one place
   (`meta.tokens`) and are substituted into answers at render time.
7. **Conflict disclosure.** Where published sources disagree, the answer arrives
   with every published value and a warning, never one confident number.
8. **Memory** of the last 10 turns, used to resolve follow-ups, discarded when the
   panel is closed. Nothing is persisted anywhere.

## Things worth knowing before you demo it

- **The `trace` button** in the panel header shows the retrieval path, matched
  entry, confidence score and measured latency for the last answer. This is the
  most useful thing to show an examiner — it demonstrates the fuzzy matching and
  the confidence floor actually firing.
- **Every answer offers to navigate.** "Show me X on the page" scrolls to the
  relevant section and flashes it. The mapping lives in the data file.
- **Ask it something off-topic** — the price of bitcoin, or to write your Python
  assignment. It refuses and gives the office number. That refusal is the point,
  not a gap.
- **The metrics in the paper are not this build's metrics.** 93% accuracy and
  1.2 s response time were measured on the VectorShift and Whisper system
  described there. Do not present them as output of this demo.

## Figures on the page

Every fee, cut-off and placement number carries a provenance level in
`meta.provenance`: `official`, `thirdparty`, `firsthand` or `unavailable`.
Contested numbers are held in `meta.conflicts` with all their variants, and 15
claims found in research material were rejected outright and recorded in
`meta.rejectedData` with reasons.

The fee figures are third-party estimates from admission aggregators that
disagree with each other by lakhs. They are labelled as estimates on the page.
Replace them with the accounts office fee sheet before this is shown to anyone
relying on it.

## Photographs and video

All photographs and clips in `assets/images/` and `assets/video/` were taken on
campus and supplied by the project author. No generated or stock imagery is
used. A second batch was reviewed for this redesign (17 photos, 19 short
clips); one photo was excluded because it showed a named individual's
certificate, and the strongest of the rest were curated in — the full set is
not dumped wholesale. See `docs/implementation-notes.md` §11 for why the
curated photos/clips appear as ordinary HTML rather than as textures inside
the WebGL scenes.

## Architecture

`docs/architecture.md` documents every pipeline module in one uniform
format — purpose, input, output, failure modes, complexity, limitations,
tests, evaluation. Start there rather than reading four source files.

Four suites, 191 assertions, none needing a browser:

```
node tests/engine-test.js          # 49  retrieval engine
node tests/director-test.js        # 37  Semantic Cinematic Director
node tests/scene-context-test.js   # 51  Conversational Spatial Memory
node tests/telemetry-test.js       # 54  telemetry
```

## Before demonstrating this

`docs/visual-qa.md` is the checklist that covers what the test suites
cannot: how it actually looks. Everything else in this project is verified
programmatically, but no headless WebGL was available where the assets
were built, so the rendered result has never been seen by anything that
made it. Run that checklist in a browser before RC1, a demo, or a study.

## Credit

Syed Usman, Sekh Mahammad Farook, Syed Afzal, Sandeep — Dept. of CSE, HKBK
College of Engineering. Under the guidance of Prof. Lijimol K.
