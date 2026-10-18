# HKBK Campus

A website for HKBK Group of Institutions, Nagawara, Bengaluru, with a first-person walking tour of the campus.

**Live site: https://namelessmonsterr.github.io/hkbk-campus/**
**Campus walk: https://namelessmonsterr.github.io/hkbk-campus/walk/**

## What is in it

**Home page** (`index.html`). A single-page college site with verified photos of the campus and a built-in enquiry assistant. The assistant answers questions about the college from a local knowledge base using fuzzy matching. It needs no server, API key or network call.

**Campus directions** (in the assistant). Ask "how do I get to the Food Court from the Main Gate" and it answers with the filmed walk route between the two stops, in order, with a distance estimate from the stop coordinates. Routes are offered only between stops the footage connects; a place with no footage (like the Library) gets an honest "cannot verify" answer, never an invented route.

**Campus walk** (`walk/`). A guided tour that starts at the Main Gate and ends at the Exam Section: 65 steps across 14 stops.

Main Gate, Football Ground, ONESB, B Block, Girls Hostel, Admin Block, PU Block, A Block, Food Court, Boys Hostel, Main Ground, Namaz Room, Xerox, Exam Section.

Every frame is a still taken from real walkthrough video of the campus. There are no renders or stock images. A small round map shows where you are on the route. Controls: arrow buttons, arrow keys, scroll, swipe, or the Walk button for autoplay.

## How it is built

- Static HTML, CSS and vanilla JavaScript. No build step, no framework.
- The walk's frames are packed into two binary files, `walk/frames4_0.bin` and `walk/frames4_1.bin`. `walk/walk-data.js` holds the stop list, map positions and frame offsets, and `walk/index.html` is the player.
- 360 view support uses [Pannellum](https://pannellum.org/) (`walk/lib/`). It only appears at stops that have a panorama.
- The enquiry assistant lives in `campus-explorer/` (`js/chatbot-engine.js`, `js/chatbot-ui.js`, `data/knowledge-base.js`). Its own README covers how it works and how to test it.
- Hosted on GitHub Pages, served from the `main` branch root.

## Run it locally

The walk loads its frames with `fetch`, so it needs a web server:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/ for the home page, or http://localhost:8000/walk/ for the walk.
