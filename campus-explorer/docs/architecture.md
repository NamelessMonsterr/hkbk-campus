# Architecture reference

Every module in the navigation pipeline, in one format, so the system can
be understood without reading four files.

## Design principles

Six rules the implementation actually follows. Each is checkable against
the code, not aspirational:

- **Explainability over black-box behaviour.** Every camera decision
  carries the intent, confidence, shot and a human-readable reason, and
  they are shown in the UI rather than logged.
- **Deterministic components over probabilistic routing.** The same query
  against the same metadata always produces the same shot. This is why
  decisions are reproducible and why the test suites can assert on exact
  framings.
- **Fail closed rather than guess.** Below the retrieval confidence floor
  the engine refuses; an ungroundable reference is reported rather than
  attached to the most recent building; a missing entrance heading
  substitutes a neutral shot and says so. A confidently wrong answer is
  worse than an admitted miss.
- **Renderer-independent reasoning.** Retrieval, grounding, viewpoint
  selection and telemetry import nothing and touch no Three.js or DOM
  type. Three.js appears in exactly one module.
- **Honest limitations, in the code.** Every approximation is documented
  where it lives — pattern matching is not called language understanding,
  world units are not called metres, pipeline latency is not called
  response time.
- **Measurable behaviour.** The pipeline emits a trace per query so its
  own failure rates can be counted rather than estimated.

## Why deterministic retrieval?

The pipeline uses deterministic retrieval and rule-based intent
classification rather than a generative model. This is a choice, not a
limitation of effort, and it buys four things the project needs:
reproducibility (the same query yields the same decision, so evaluation
runs are comparable), explainability (a keyword match can be shown to a
user; an attention pattern cannot), bounded latency (no network round
trip, no token generation), and offline operation.

The cost is real and is stated plainly elsewhere in this document: the
system retrieves or refuses. It cannot rephrase, summarise across entries,
or answer a question nobody wrote an answer for. `setLlmHook()` in
`js/chatbot-engine.js` is the documented attachment point for a generative
backend, and remains future work.

```
                          USER
                            |
                  natural-language query
                            |
                            v
                 [1] Retrieval Engine
                     what is being asked about
                            |
              +-------------+-------------+
              |                           |
              v                           v
   [2] Conversational            [3] Semantic Cinematic
       Spatial Memory  --------->     Director
       which building?    target       how to frame it?
              |            id                |
              +-------------+---------------+
                            |
                            v
                  [4] Presentation Layer
                     executes the move
                            |
                            v
                     visual response
                     + explanation panel
                            |
                            v
                     [5] Telemetry
                     records what happened
```

CSM and the Director **cooperate rather than forming a straight chain.**
CSM supplies the target when the query names no building; the Director
supplies the framing given the intent. Either can run without the other —
a named building skips CSM entirely, and if CSM resolves a reference the
Director still classifies intent independently. The renderer degrades to
a generic fly-to if either is absent.

Modules 1, 2, 3 and 5 have **no renderer dependency** and are unit-tested
in bare Node. Module 4 is the only place Three.js appears.

---

## [1] Retrieval Engine

| | |
|---|---|
| **File** | `js/chatbot-engine.js` |
| **Purpose** | Answer campus questions from a curated knowledge base |
| **Input** | Query string; knowledge base (`data/knowledge-base.json`) |
| **Output** | Answer text, entry id, confidence, type (`answer` / `out_of_scope`) |
| **Failure modes** | Below 0.17 cosine confidence it refuses and hands over phone numbers. Cannot answer questions nobody wrote an answer for — it retrieves or refuses, it does not generate |
| **Complexity** | TF-IDF over 32 entries; retrieval is O(entries × terms), sub-millisecond in practice |
| **Limitations** | No generative model. Script-based language ID only — romanised Kannada reads as English. Word tokens stand in for BPE tokens |
| **Tests** | `tests/engine-test.js` — 49 assertions |
| **Evaluation** | Not yet measured on this build. The paper's 93% figure belongs to a different system (VectorShift + Whisper) and must not be presented as this one's |

---

## [2] Conversational Spatial Memory (CSM)

| | |
|---|---|
| **File** | `js/3d/campus/scene-context.js` |
| **Purpose** | Ground follow-up queries in whatever is currently on screen |
| **Input** | Query string; scene context (5 fields); building metadata |
| **Output** | `{ resolved, targetId, kind, reason }`; nearby lists with distance and bearing |
| **Failure modes** | Fails closed. No building visited, or context older than the 5-minute TTL → refuses to ground and says why, rather than assuming the most recent target |
| **Complexity** | O(patterns) per query; O(buildings) for relational queries. Constant memory — five fields, no history |
| **Limitations** | Pattern-based, **not** coreference resolution. Fixed deictic list; will not resolve "the one with the glass front". Distances are world units, not surveyed metres. Bearings assume +z is north, an internal convention |
| **Tests** | `tests/scene-context-test.js` — 51 assertions |
| **Evaluation** | Context hit rate and grounding success rate, via telemetry |

---

## [3] Semantic Cinematic Director (SCD)

| | |
|---|---|
| **File** | `js/3d/campus/director.js` |
| **Purpose** | Map user intent to an appropriate cinematic viewpoint |
| **Input** | Query string; target metadata (bounds, world position, entrance heading) |
| **Output** | Intent + confidence, selected shot, camera position/target/FOV/duration/easing, and a reason string |
| **Failure modes** | Unmatched query falls back to a wide establishing shot at zero confidence rather than guessing. Missing entrance heading skips the entrance shot and reports the substitution. Missing bounds throws rather than mis-framing |
| **Complexity** | O(intents × patterns) classification, constant-time shot solve |
| **Limitations** | Intent classification is a **scored keyword matcher with a directive-phrase bonus**, not learned and not an LLM. Reported confidence is a match score, not a calibrated probability. Registry `entranceHeading` values are placeholders facing the internal road — **not surveyed**. Shots are tuned against placeholder boxes and will need re-tuning against real models |
| **Tests** | `tests/director-test.js` — 37 assertions |
| **Evaluation** | Shot distribution and intent-fallback rate via telemetry; camera appropriateness via user study. `genericFlyTo()` is retained as the control condition |

---

## [4] Presentation Layer

*(Called the renderer earlier in the project's history. "Presentation
layer" is more accurate: besides drawing frames it executes camera moves,
surfaces the Director's reasoning, handles every fallback path, and owns
all user interaction.)*

| | |
|---|---|
| **File** | `js/3d/campus/campus-app.js`, `campus.html` |
| **Purpose** | Execute camera moves; render the scene; surface explanations |
| **Input** | Director decisions; building registry; HDRI; optional `.glb` models |
| **Output** | Rendered frames; info panel with the decision's reasoning |
| **Failure modes** | No WebGL2 or `prefers-reduced-motion` → static fallback page. Missing `.glb` → procedural placeholder with a console notice. Missing HDRI → hemisphere light with a warning. Missing Director or CSM → generic fly-to, warned |
| **Complexity** | Instanced trees; SSAO desktop-only; pixel ratio and tree count tiered by viewport |
| **Limitations** | Requires an http(s) origin — ES modules and GLTF are blocked on `file://`. Addon modules come from a CDN (assets do not). Walk mode has no collision. No LOD. No interiors |
| **Tests** | None automated — no headless WebGL available. Manual verification only |
| **Evaluation** | Frame time and FPS, not yet instrumented |

---

## [5] Telemetry

| | |
|---|---|
| **File** | `js/3d/campus/telemetry.js` |
| **Purpose** | Record one trace per query; compute evaluation aggregates |
| **Input** | Per-query outcome fields from the guide handler |
| **Output** | Traces; summary (context hit rate, grounding success, shot/intent distribution, latency percentiles, explainability invariant); JSON and CSV export |
| **Failure modes** | Ring buffer at 500 traces — drops oldest and **discloses** that the window is truncated. Missing latency does not corrupt the summary. Empty recorder returns null ratios, not NaN |
| **Complexity** | O(1) record, O(n) summarize. Bounded memory |
| **Caveat on explainabilityRate** | Expected to be exactly 1.0 **by construction** — `director.direct()` cannot return without a reason string. Report it as an invariant that held, not as a result that was achieved; "our system achieves 100% explainability" is circular and a reviewer will say so. Its real value is regression detection: below 1.0 means some path produced a camera decision with no explanation, which is a bug |
| **Limitations** | **Latency measures pipeline time only** — intent classification, grounding, shot solving. It excludes frame time, camera animation and model loading. Reporting it as "response time" without that qualification would be misleading |
| **Privacy** | Nothing is transmitted — no endpoint, no analytics service, no persistent identifier. Traces live in memory and are lost on reload unless exported by hand. **Query text is recorded by default** and participants must be told so; construct with `{ recordQueryText: false }` to store only length and word count |
| **Tests** | `tests/telemetry-test.js` — 49 assertions |
| **Evaluation** | This module *is* the evaluation instrument |

---

## Test coverage at a glance

| Module | Assertions | Browser dependency |
|---|---|---|
| Retrieval Engine | 49 | No |
| Semantic Cinematic Director | 37 | No |
| Conversational Spatial Memory | 51 | No |
| Telemetry | 54 | No |
| Presentation Layer | manual verification only | Yes |
| **Total** | **191** | |

The presentation layer has no automated tests because no headless WebGL is available
in this environment. That is a real gap, not a design choice — it is the
one module whose regressions would only be caught by looking at the page.

**Keep this table, the README, and the paper in agreement.** The numbers
have already drifted once (186 → 191 when the explainability invariant was
added to the telemetry suite). Re-run the suites and update all three
together whenever a test is added.

## Running the suites

```
node tests/engine-test.js          # 49
node tests/director-test.js        # 37
node tests/scene-context-test.js   # 51
node tests/telemetry-test.js       # 54
```

191 assertions. None require a browser.

## Retrieving a run

In the browser console on `campus.html`:

```js
HKBKTrace.summary()    // aggregates
HKBKTrace.problems()   // unanswered, fallback, degraded, ungrounded
HKBKTrace.csv()        // copy into a spreadsheet
HKBKTrace.json()       // full export with summary
HKBKTrace.clear()      // reset between participants
```

## Model export conventions

The Director re-solves every shot from a loaded model's bounding box
(`setBoundsFromObject`), so a badly exported `.glb` silently misframes all
six shots with no error anywhere. Non-negotiable:

- **Scale:** 1 Blender unit = 1 metre. **Apply transforms before export**
  (Ctrl+A → Rotation & Scale). An unapplied scale exports geometry that
  looks correct but reports a bounding box off by that factor.
- **Origin:** ground level, footprint centre. Not the roof, not the
  entrance, not a corner, not whatever pivot the import left behind.
- **Axes:** Blender is **Z-up**; glTF is **Y-up**; the exporter converts.
  Model Z-up and let it convert — do **not** pre-rotate the mesh to
  "fix" the axis, or it double-converts and the building arrives on its
  side.
- **Naming:** `main_block`, `glass_windows`, `roof`, `entrance` — not
  `Cube.001`. Same for materials: `concrete`, `glass`, `metal`, one per
  logical surface.
- **Mesh:** quads where possible, no ngons, merged duplicate vertices,
  recalculated normals. UVs even if textures come later.
- **File:** `assets/models/<building-id>.glb`, matching the `id` in the
  `BUILDINGS` registry. Draco compression optional — the loader is already
  configured for it.

Drop a model at that path and it replaces the placeholder automatically.
No code change.

## Claim discipline

This document separates three things and never lets them blur: **implemented
behaviour** (what the code does today), **planned future work** (what it
does not do), and **evaluation methodology** (how it would be measured).
Future work is deliberately excluded from implementation claims, and
unmeasured quantities are named as unmeasured rather than estimated.

Carry the same separation into the paper:

| Implemented | Evaluated | Future work |
|---|---|---|
| Retrieval engine | User study (task time, errors) | Real campus models |
| Conversational Spatial Memory | Grounding success rate | Building interiors |
| Semantic Cinematic Director | Camera appropriateness | Generative backend via `setLlmHook()` |
| Presentation Layer | Navigation performance vs. control | Additional languages |
| Telemetry | Shot and intent distribution | Larger campus datasets |

Note that the middle column is currently **empty of results** — the
instrument exists, the study does not. Nothing in it may be reported until
it is run.

## What is NOT measured yet

Task completion time, navigation errors, satisfaction, and any comparison
against a conventional website. Those need a user study; telemetry only
provides the system-side half of the picture.

---

## Document status: locked

The architecture is frozen. This document should now change only for:

- bug fixes that alter documented behaviour
- test count changes
- measured evaluation results, once a study has been run
- implementation changes that actually occurred

Not for renaming modules, adding subsystems, or refining descriptions of
things that already work. Everything else belongs in the paper or in
future work. At this stage stability is worth more than further polish.

## Offline dependency fix (post-freeze bugfix)

**Bug found in the field:** `campus.html` loaded Three.js and its addon
modules from `cdn.jsdelivr.net`. On any network that blocks that CDN —
college wifi, a corporate firewall, an ad-blocker, or simply no internet —
the ES module import failed silently before `campus-app.js` ran at all.
The page rendered nothing: no error banner, just the black intro overlay
forever, because the code that would have lifted it never executed.

This contradicted the project's own stated design principle
("why deterministic retrieval?" / offline execution) — the HDRI, textures
and model were vendored locally for exactly this reason, but the renderer
itself was still calling out to a CDN.

**Fix:** Three.js 0.160.0 and every addon module actually imported
(`GLTFLoader`, `DRACOLoader` + its decoder, `RGBELoader`, `OrbitControls`,
`PointerLockControls`, the full postprocessing chain and their shader/util
dependencies — 20 files, resolved by walking the real import graph rather
than guessing) are vendored under `js/vendor/three/`, 2.3 MB. The import
map in `campus.html` and the Draco decoder path in `campus-app.js` now
point there instead of jsDelivr.

Verified by serving the folder locally and requesting every file
`campus.html` transitively loads — all return HTTP 200, zero CDN references remain
in the project. This is a bugfix within the frozen architecture: no module
boundary, no API, and no test changed.
