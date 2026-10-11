# Visual QA — RC1 gate

Everything in this project is verified programmatically **except how it
looks.** No headless WebGL is available in the environment the assets were
built in, so geometry, scale, origin, UV coverage, texture embedding,
sampler modes and material assignment are all machine-checked — and
nothing about the rendered result is.

This is the checklist that closes that gap. It has to be done by a person,
in a browser, before RC1 is called.

```
python3 -m http.server 8000
# then http://localhost:8000/campus.html
```

---

## 1. Does it load at all

- [ ] No console errors on load
- [ ] `main-block.glb` loads — the main block is the modelled building, not
      a box. (If it's a box, the console will say
      `no model at assets/models/main-block.glb yet`)
- [ ] HDRI loads — no `campus-sky.hdr failed to load` warning
- [ ] Textures load — no 404s under `assets/textures/`
- [ ] `director.js`, `scene-context.js`, `telemetry.js` all load (each warns
      by name if absent)

## 2. Scale sanity

The whole scene was converted to metres. This is where a mistake would
show first.

- [ ] The main block reads as a five-storey building, not a shed or a tower
- [ ] Trees are plausibly 5–9 m, not bushes and not redwoods
- [ ] Lamp posts are roughly human-scale-relative (~7 m)
- [ ] In Walk mode the eye height feels like standing, not floating or crawling
- [ ] Other buildings look proportionate to the main block — **note these
      are scaled estimates, not measured**

## 3. Materials and texturing

- [ ] **Does the concrete repeat obviously?** Look at the long fin wing
      from a distance — a visible grid of identical patches means the tile
      is too small or the noise too structured
- [ ] Any visible UV seams where two surfaces meet
- [ ] Texel density consistent — the grain on a fin shouldn't be a
      different size from the grain on the wall behind it
- [ ] Do the normal maps read at realistic distance, or do they vanish at
      20 m / turn to noise up close
- [ ] Does the glass reflect naturally, or read as a flat mirror
- [ ] Plinth and steps still darker than the fins (the `baseColorFactor`
      mean-division should have preserved this)

## 4. Lighting

- [ ] Shadows land in the direction the HDRI sun implies — mismatch here is
      the single most common "looks fake" cause
- [ ] Contact shadows read at the base of each building; nothing floats
- [ ] No shadow acne, no peter-panning (shadow detached from its object)
- [ ] Exposure reveal on load is smooth, not a flash or a stall
- [ ] **Check at sunset and night** — let the day/night cycle run a full
      70 s. Windows and lamp heads should come up together; materials
      should not go muddy or blow out

## 5. Camera

- [ ] Intro plays: high altitude → glide → bank → descent → settle
- [ ] Horizon is level at handover (the bank should fully unwind)
- [ ] Any input skips it immediately
- [ ] HUD and guide stay hidden until handover
- [ ] Idle breathing is barely perceptible, and the camera does not drift
      away over a minute of no input
- [ ] Orbit min/max distances feel right at metre scale

## 6. Director shots

Ask the guide each of these and watch the framing:

- [ ] "take me to the main block" → entrance visible, ~50 m, doors readable
- [ ] "what does the main block look like" → low three-quarter, facade fills
      frame, verticals near-parallel
- [ ] "show me the whole campus" → wide, campus legible
- [ ] "what facilities are here" → neighbours visible in frame
- [ ] "admission fees" → approach framing on the admin block
- [ ] Each of the above is *visibly* a different shot, not the same move
      from a different distance
- [ ] The lens change is perceptible on the detail shot (55°→34° compresses)

## 7. Conversational grounding

- [ ] "take me to the library" then "how many books are there" — stays on
      the library
- [ ] then "what is nearby" — names neighbours with directions, camera
      does **not** move
- [ ] then "go back" — returns to the previous building
- [ ] "what is the cet code" — answers without moving the camera
- [ ] Explain panel shows intent, confidence, shot, lens, framing, reason

## 8. Performance

- [ ] 60 fps desktop during the intro (the most expensive moment)
- [ ] 30 fps+ on a real phone, not a desktop devtools emulation
- [ ] No stutter when a fly-to starts
- [ ] Memory stable over five minutes — a leak shows as a slow fps decline

## 9. Fallbacks

- [ ] `prefers-reduced-motion` → static fallback page, no errors
- [ ] Opened as `file://` → the fallback message, not a blank page
- [ ] Rename `main-block.glb` temporarily → procedural box returns, console
      says so, nothing else breaks
- [ ] Rename `campus-sky.hdr` temporarily → hemisphere fallback, warned,
      scene still lit

## 10. Telemetry

- [ ] `HKBKTrace.summary()` returns sensible counts after a few queries
- [ ] `HKBKTrace.csv()` opens cleanly in a spreadsheet
- [ ] `explainabilityRate.ratio` is exactly 1 — below 1 is a bug, not a
      finding
- [ ] `HKBKTrace.clear()` resets between participants

---

## Recording the result

Note the date, browser, GPU and screen resolution against the run. If
anything fails, fix it before RC1 rather than noting it as a limitation —
these are all bugs, not scope decisions.

---

This checklist is intentionally excluded from automated verification.
Every item requires human observation in a browser. RC1 cannot be declared
until all of them have been checked by a person.

**Nothing in this file has been done yet.**
