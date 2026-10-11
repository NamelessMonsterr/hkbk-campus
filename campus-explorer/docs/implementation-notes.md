# Implementation notes

What this build does differently from the paper, and why. Written so that nothing
in the report has to be defended with a guess.

## 1. No LLM, no VectorShift, no Whisper

The paper's pipeline is VectorShift for retrieval, an OpenAI model for generation
and a fine-tuned Whisper model for speech. None of the three can run inside a page
opened from the local filesystem: the first two need API keys and network calls,
and Whisper would mean shipping tens of megabytes of model weights.

What is here instead:

| Paper | This build |
| --- | --- |
| VectorShift vector store | TF-IDF index built in the browser, cosine similarity |
| OpenAI LLM generation | Retrieval of pre-written answers, no generation |
| Fine-tuned Whisper ASR | Nothing — voice was cut from scope |
| Chat token buffer memory | 10-turn array, discarded on session end |

**Consequence to be honest about:** because there is no generative model, the
assistant cannot rephrase, summarise across entries, or answer a question nobody
wrote an answer for. It retrieves or it refuses. `setLlmHook()` exists as the
documented swap point where a Flask or Node backend would be attached.

## 2. Word tokens stand in for BPE tokens

The paper specifies 512-token chunks with 64-token overlap. Those counts assume a
subword tokeniser. This build splits on Unicode letter and number runs, so a
"token" is roughly a word. The chunk and overlap numbers are kept at 512 and 64
for fidelity to the paper, but a chunk here holds more text than the paper's
chunk did. With 32 short entries this has no practical effect — no entry is long
enough to be split badly — but the numbers are not directly comparable.

## 3. Language identification is script-based only

Detection reads Unicode ranges: Kannada `U+0C80–U+0CFF`, Devanagari, Arabic.

**Known limit:** romanised Kannada typed in Latin script ("hostel fee estu") is
identified as English. The paper used a trained classifier and IndicNLP
normalisation, which would handle this. A script check cannot.

## 4. Shipping English only, with the other languages left in place

`meta.languages` is `["en"]`. Kannada answers are written for the core entries and
Hindi and Urdu for a subset; they sit in the same file under
`meta.availableLanguages` and are simply not indexed.

Re-enabling is a one-line data change — add `"kn"` to `meta.languages`. No code
changes. A test proves this: it clones the knowledge base, flips the array, and
asserts a Kannada question comes back answered in Kannada script with Kannada
figures and no English numerals spliced in.

Eleven of the 32 entries have no Kannada text yet. Those would fall back to
English, which the engine reports as `languageFellBack: true`.

## 5. The confidence floor is an addition, not a reproduction

Section V of the paper records that out-of-scope questions produced invented
answers, and Section VI lists out-of-scope detection as work to be done before
deployment. It was flagged, not built.

This build implements it: below a cosine confidence of 0.17 the engine returns
`type: "out_of_scope"`, a refusal, and contact details. Three junk queries are in
the test suite to hold that behaviour in place.

The floor of 0.17 was tuned by hand against the 145 indexed phrasings. It is not a
value from the paper and should be described as such.

## 6. Fuzzy matching follows the paper exactly

Levenshtein similarity at a 0.78 threshold, applied per unmatched query word,
capped at 60 characters to bound the cost. This is the one component reproduced
faithfully. The paper reports it recovered around 11% of otherwise-failed queries;
this build does not claim to reproduce that percentage, having no comparable query
log.

## 7. Memory

Ten turns, matching the paper. Cleared when the panel is closed. Nothing is
written to `localStorage`, a cookie, or a server. The paper's admitted long-session
amnesia is therefore reproduced rather than fixed.

Follow-up resolution only injects prior context when the current match is weak
(confidence below 0.55) and the query looks like a follow-up, and only adopts the
contextual match if it scores higher. An earlier, looser version hijacked "is
there a metro station nearby" into the previous topic; the test suite now pins
that query to the right entry.

## 8. Data honesty mechanisms not in the paper

The research material gathered for this project contained fabrications, so three
mechanisms were added:

- **`meta.provenance`** — every figure is tagged `official`, `thirdparty`,
  `firsthand` or `unavailable`.
- **`meta.conflicts`** — 23 registries of contested figures. 14 entries link to
  them, and answers arrive with all published values rather than one.
- **`meta.rejectedData`** — 15 claims rejected with reasons, kept in the file so
  the rejection is auditable. Examples: an anti-ragging number of
  `+91 9898989898`; a placed student listed as Chairman; a "Nagavara Metro Station
  (Green Line)" that does not exist; an "IMPORTANT DATES 2026" table containing
  2025 dates.

Two entries exist specifically to prevent confident wrong answers:
`metro-connectivity` states plainly that there is no operating metro, and
`leadership` deliberately refuses to name a Principal because three sources give
three different names.

## 9. Metrics

The paper reports 93% average accuracy (95% English text, 91% Kannada text, 88%
and 83% by voice), response time falling from 2.5 s to 1.2 s, precision 90%,
recall 88%, F1 89%, and speech recognition at 85%.

**Those are reported results of the system described in the paper. They are not
measurements of this build.** This build has been verified by 49 assertions, not
by an accuracy study. The `trace` panel shows the real per-query latency of this
implementation, which is sub-millisecond retrieval over a 32-entry index — fast
for reasons that have nothing to do with the paper's 1.2 s figure.

## 10. Voice was considered and cut

An optional voice layer using the browser's `SpeechRecognition` and
`speechSynthesis` was written and then removed at the author's instruction. Worth
recording why it would have been a compromise anyway: Chrome's implementation
uploads audio to Google's servers, so it needs internet and is not the paper's
offline-capable Whisper pipeline, and `kn-IN` recognition is unreliable — which is
precisely why the paper needed a fine-tuned model.

## 11. 3D and motion

Three.js r140 (npm `three@0.140.0`, global/UMD build) is vendored at
`js/vendor/three.min.js` and loaded as a plain `<script>` tag, not
`type="module"` - file:// blocks module script loading when the page is opened
by double-click. r140 was chosen deliberately over the current release: Three.js
stopped publishing a global build after r160 (ES modules only from ~r165 on),
and r140 predates a console warning newer global builds print on load, so it
loads silently.

Three procedural WebGL scenes, each lazy-initialised via the same
`IntersectionObserver` idiom the `.reveal` scroll system already used, and each
gated behind `HKBK3D.canRender()` (`js/3d/webgl-support.js`), which checks for a
real WebGL context and `prefers-reduced-motion`:

- **Hero** (`js/3d/hero-scene.js`) - a continuously-flying tunnel of lit,
  glowing hexagonal rings with a drifting particle field and a pulsing
  glow-core, rendered on a transparent canvas layered over the curated hero
  video.
- **Campus showcase** (`js/3d/gallery-scene.js`) - a procedural field of lit
  hex-crystal prisms and particles the visitor can drag-rotate and
  scroll-wheel fly through, added as a sibling of the existing `#campus`
  figures.
- **Chapter transition** (`js/3d/transition-scene.js`) - a scroll-driven
  "stargate" of expanding hex rings between `#about` and `#courses`, with a
  dark hex-bracket info card fading in as real DOM.

**A hard constraint discovered while building this, not a design choice:**
Chrome treats every `file://` resource as its own opaque origin. A local image
or video read into a WebGL texture via `texImage2D` comes back
canvas-tainted and renders solid black - confirmed empirically for both
`<img>` and `<video>` sources while building the hero scene. This is the same
constraint the README already documents for `fetch()`, just hitting WebGL
instead. Consequence: none of the three scenes use photo or video textures.
The curated campus photos and clips are shown as ordinary HTML
(`<img>`/`<video>`) instead, which has no such restriction - the hero scene
overlays its canvas on top of a normally-playing `<video>` rather than reading
its pixels, and the campus media (`.campusStrip` in `#campus`) is a plain
horizontal-scroll strip.

Fallback is unconditional: with no WebGL, or `prefers-reduced-motion` set, each
scene script does nothing and the page's existing static markup (the hero
`<img>`, the `#campus` `.split` figures, the `.chapter__card`'s own `.reveal`
animation) renders exactly as it did before this redesign - no broken states,
no console errors. The `prefers-reduced-motion` media query in `css/main.css`
was extended to also flatten the new card/stat tilt and hex-motif CSS
animations, not just `.reveal`.

## Open data questions

These cannot be resolved from public sources and need the college office:

1. Official fee sheet — published figures differ by lakhs.
2. Highest package — Rs 31.4 LPA against Rs 32.4 lakh.
3. Current NAAC grade — the verifiable certificate expired in June 2022.
4. Current Principal — three names in circulation.
5. Whether Civil and Electrical & Electronics are currently admitting.
