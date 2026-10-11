# HKBK site — cinematic 3D redesign

## Context

The existing project (`index.html`, `css/main.css`, `js/`, `data/`) is a working, fully
offline, single-page HKBK College site with a retrieval-based enquiry assistant
(TF-IDF + fuzzy matching, no LLM, no network calls, 49 passing assertions in
`tests/engine-test.js`). It ships a cream/light editorial theme with oversized serif
display type, and explicitly notes in `docs/implementation-notes.md` that no 3D was
attempted because "no WebGL library is available offline" — depth was faked with CSS
layering, scale contrast and scroll reveals instead.

Two new inputs prompted this redesign:

- `IDea.mp4` — not a college site, a demo of an unrelated crypto/DeFi product
  ("maxBTC"). It is used **only as a style and interaction reference**: painterly
  cinematic hero, elegant serif type over a dark base, hexagonal/angular wireframe
  card accents, and scroll-triggered storytelling panels.
- `CLlg Img VIdeo.zip` — 36 new campus files (6 JPEGs, 30 short WhatsApp video clips)
  to be curated (not dumped wholesale) into the redesigned site alongside the 25
  existing photographs in `assets/images/`.

The "no WebGL offline" constraint from the implementation notes no longer holds:
Three.js can be vendored as a single local file, downloaded once, with zero runtime
network calls afterward — the page remains fully `file://`-openable and offline.

## Goals

1. Redesign the visual language of the whole site to be dark, cinematic and
   distinctive, taking style cues from `IDea.mp4` (typography, hex/angular accent
   linework, dark base) without copying its unrelated DeFi content or literal layout.
2. Introduce real WebGL 3D (Three.js) at a small number of high-impact moments, while
   keeping the content-heavy sections (fees, admissions, facts) fast and readable with
   CSS-only 3D/parallax.
3. Curate and integrate the best of the 36 new photos/clips from the zip.
4. Preserve everything that already works: the tested chatbot engine, the honest data
   provenance/conflict/refusal mechanisms, full offline operation via double-click,
   and all existing anchor IDs so chatbot page-navigation keeps working.
5. Restyle the chatbot UI to match the new theme without touching its logic.

## Non-goals

- No change to `js/chatbot-engine.js` or `data/knowledge-base.json` retrieval logic.
- No build step, bundler, framework, or CDN dependency — vanilla JS/CSS plus one
  vendored Three.js file, matching the project's existing "no build step" constraint.
- No attempt to reproduce `IDea.mp4`'s content, product, or copy — style only.
- Not a full scrollytelling app: 3D is scoped to hero + one gallery/showcase moment +
  one chapter transition, not the entire page.

## Architecture

### Theme

- New CSS custom properties replace the cream palette in `css/main.css`: a dark base
  (near-black, not pure `#000`), the existing serif stack (`Didot`, `Bodoni MT`,
  `Playfair Display`, …) kept for display type since it's already offline-safe, sans
  stack kept for labels/UI chrome.
- New shared visual motif: thin hexagonal/angular wireframe linework, used for section
  dividers, card borders, and the chatbot panel frame — the one element borrowed
  directly from the reference video's aesthetic.
- All existing section anchor IDs (`#about`, `#courses`, `#admissions`, `#fees`,
  `#placements`, `#campus`, `#hostel`, `#life`, `#contact`) are preserved unchanged so
  `onNavigate` in `index.html`'s boot script and the chatbot's "show me X" flow keep
  working with no code change there.

### 3D scope (Three.js, vendored locally)

`js/vendor/three.min.js` is downloaded once and committed to the repo; no runtime
network access. Three scenes are lazy-initialized only when their section nears the
viewport (`IntersectionObserver`, the same pattern the reveal-on-scroll code already
uses).

1. **Hero scene** (`js/3d/hero-scene.js`) — the hero image/video mapped onto a plane
   with depth, floating low-poly hexagonal wireframe fragments drifting in parallax,
   subtle camera drift on mouse move (disabled under `prefers-reduced-motion`).
2. **Campus showcase / gallery scene** (`js/3d/gallery-scene.js`) — curated photos and
   muted looping video clips arranged on a draggable/scrollable 3D ring, replacing or
   augmenting the current `#campus` split-image layout.
3. **One chapter transition** — a short scroll-driven camera move between two
   sections (About → Courses), with dark hex-bracket-cornered card panels fading in,
   styled after the reference video's info-card treatment. Implemented as part of
   whichever scene is active at that scroll position, not a separate persistent scene.

Everything else (fact lists, stat blocks, fee figures, admissions text, scholarship
cards, footer) stays CSS-only: tilting cards, layered parallax, magnetic hover — no
WebGL cost on sections where visitors are reading numbers and provenance notes.

### Fallback

WebGL support is feature-detected once at load. If unavailable, or if
`prefers-reduced-motion` is set, the hero and gallery fall back to the existing static
image + CSS parallax treatment already implemented in `main.css` — no broken states,
no console errors, page remains fully usable.

### Chatbot UI

`js/chatbot-ui.js` is restyled only (dark glass panel, hex-bracket corner accents,
same trace panel / navigate / memory behavior). `js/chatbot-engine.js` and
`data/knowledge-base.json` / `.js` are not modified by this redesign.

### Media curation

All 36 files in `CLlg Img VIdeo.zip` are reviewed (video via extracted frame
sampling, since they can't be played directly during review). The strongest 1-3 clips
become muted, looping backgrounds for the hero and/or gallery scene; the strongest
stills join the gallery ring and section figures alongside the 25 existing images in
`assets/images/`. Curated assets land in `assets/video/` (new) and
`assets/images/` (existing folder, new files added with the same on-campus-photo,
no-stock-imagery standard already documented in the README).

### File layout changes

```
js/vendor/three.min.js       new — vendored Three.js build
js/3d/hero-scene.js          new — hero WebGL scene + fallback
js/3d/gallery-scene.js       new — gallery/showcase WebGL scene + fallback
assets/video/                new — curated clips from the zip
css/main.css                 rewritten — dark theme, hex motif, existing selectors/
                              structure kept where behavior (reveal, masthead, chat)
                              depends on them
js/chatbot-ui.js             restyled only, no behavior change
index.html                   sections restructured for the new visual treatment,
                              same anchor IDs, same data/script load order
```

`data/`, `tests/`, `docs/implementation-notes.md` (updated to reflect that 3D is now
implemented, superseding the "no WebGL available offline" note) are otherwise
unaffected.

## Testing

- `tests/engine-test.js` continues to run unmodified and must still pass all 49
  assertions (`node tests/engine-test.js`) — proves the chatbot logic is untouched.
- Manual verification pass (no automated visual testing available offline):
  double-click `index.html`, confirm the page loads with no console errors, confirm
  the assistant opens/answers/navigates correctly, confirm hero and gallery 3D scenes
  render, confirm the `prefers-reduced-motion` / no-WebGL fallback path renders
  correctly (simulate via devtools).
- `docs/implementation-notes.md` gets a short new entry documenting the 3D approach
  actually taken, replacing the old "no WebGL library available offline" statement.

## Open questions carried over from the existing project

Unchanged by this redesign — still true and still worth surfacing on the page:
official fee sheet, highest package figure, current NAAC grade, current Principal,
and whether Civil / Electrical & Electronics are currently admitting all remain
unresolved data questions per `docs/implementation-notes.md`.
