# HKBK Campus

> Most college websites show you a stock photo.
> This one lets you walk in through the gate.

A website for HKBK Group of Institutions, Nagawara, Bengaluru, built around a first-person walk through the real campus, with a question-answering assistant that runs entirely in the browser.

**Live site:** https://namelessmonsterr.github.io/hkbk-campus/
**Campus walk:** https://namelessmonsterr.github.io/hkbk-campus/walk/

![HKBK main facade](assets/facade.jpg)

---

## Core claim

Every picture on this site is a real photo or a real video frame of the campus. No stock images, no renders, no generated imagery. Every fact on the site is checked against the college's own website, and the page it came from is linked.

---

## What you get

| Piece | What it is |
|-------|-----------|
| **Home page** | Single-page college site: the six colleges, department rows with intake history, placements, rankings and recent news, all taken from hkbk.edu.in with the source page linked |
| **Campus walk** | 65 steps across 14 stops, from the Main Gate to the Exam Section. Arrow keys, scroll, swipe or autoplay. A small round map shows where you are |
| **Ask HKBK** | An enquiry assistant that answers questions about the college. No server, no API key, no LLM, no network call |

### The walk

Main Gate, Football Ground, ONESB, B Block, Girls Hostel, Admin Block, PU Block, A Block, Food Court, Boys Hostel, Main Ground, Namaz Room, Xerox, Exam Section.

Each frame is a still taken from walkthrough video shot on the campus. The tour opens at step 1 and ends at step 64, with the Exam Section (step 65) visited right after the Namaz Room (step 60). Every step has its own link, for example `walk/#30`, and a link always opens the same image.

---

## How the assistant works

The assistant is a retrieval system, not a language model. Given a question it:

1. Normalises the text and fuzzy-matches it against the tags and question variants of each knowledge base entry.
2. Scores the entries with TF-IDF cosine similarity.
3. Returns the stored answer of the best entry, or says it does not know.

Because the answers are written by hand and not generated, it cannot invent a fee or a date.

Where published sources disagree (for example the highest placement package), the assistant says so and shows the range instead of picking one number.

| | |
|---|---|
| Knowledge base | 41 entries: courses, admissions, fees, scholarships, placements, campus, hostel, contact, colleges, department intake history, rankings, news |
| Sourcing | Answers carry the wording "as published by the college" and name the page |
| Engine tests | 49 passing (`node chatbot/tests/engine-test.js`) |
| Runs on | Any modern browser, offline |

The approach follows the paper *Intelligent Chatbot For College Inquiry And Support: Using Fuzzy Matching And LLM* (Dept. of CSE, HKBK College of Engineering). This build keeps the fuzzy matching and retrieval and leaves out the LLM.

---

## How it is built

```text
index.html                    home page, plain HTML + CSS + JS
   |
   +-- walk/                  the campus walk
   |     index.html           player
   |     walk-data.js         stops, map positions, frame offsets
   |     frames4_0.bin        frames, pack 1
   |     frames4_1.bin        frames, pack 2
   |     lib/                 Pannellum, for the optional 360 view
   |
   +-- chatbot/               the assistant
         js/chatbot-engine.js   fuzzy match + TF-IDF retrieval
         js/chatbot-ui.js       chat widget
         data/knowledge-base.js the knowledge base
```

- No build step and no framework. The whole site is static files.
- The walk's frames are packed into two binary files and read with `fetch` and byte offsets, so a visit downloads a few large files instead of 65 small ones.
- Hosted on GitHub Pages, served from the root of `main`.

---

## Run it locally

The walk loads its frames with `fetch`, so it needs a web server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/ for the home page, or http://localhost:8000/walk/ for the walk.

Run the assistant's tests (Node needed):

```bash
cd chatbot
node tests/engine-test.js
```

---

## Repository map

| Path | Contents |
|------|----------|
| `index.html` | Home page |
| `assets/` | Home page photos and the chat widget stylesheet |
| `walk/` | Campus walk (see `walk/README.md`) |
| `chatbot/` | The assistant: engine, UI, knowledge base, tests (see its README) |

---

## Sources

- College facts: [hkbk.edu.in](https://www.hkbk.edu.in/). Placements, rankings, intakes, electives and news come from the official pages for each department and from `/engineering/placements` and `/engineering/rankings-recognitions`.
- Where the official site disagrees with itself (the campus is 17 acres on the About page and 14 on the home page tile), the site uses the About page and the knowledge base keeps both figures.
- Photos and walk frames: shot on the campus.
- 360 view: [Pannellum](https://pannellum.org/).

---

Built by [@NamelessMonsterr](https://github.com/NamelessMonsterr).
