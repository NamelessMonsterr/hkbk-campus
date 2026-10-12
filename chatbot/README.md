# Ask HKBK: the enquiry assistant

A retrieval-based chatbot for the home page. It fuzzy-matches the question against a hand-written knowledge base and answers with the stored text. No server, no API key, no language model, no network call.

Follows the approach in *Intelligent Chatbot For College Inquiry And Support: Using Fuzzy Matching And LLM* (Dept. of CSE, HKBK College of Engineering), with the LLM left out.

## Files

```text
js/chatbot-engine.js     retrieval, fuzzy matching, memory, refusal logic
js/chatbot-ui.js         rendering only
data/knowledge-base.json source of truth: 41 entries and all figures
data/knowledge-base.js   generated from the JSON, loaded by the page
tests/engine-test.js     49 assertions over the engine
```

## The knowledge base exists twice

`knowledge-base.json` is the file to edit. `knowledge-base.js` wraps the same data in `window.HKBK_KB` so the page can load it with a plain script tag, with no `fetch`. Regenerate it after every edit:

```bash
python3 -c "
import json
d = json.load(open('data/knowledge-base.json'))
open('data/knowledge-base.js', 'w').write(
    '/* GENERATED from knowledge-base.json - do not edit by hand. */\nwindow.HKBK_KB = '
    + json.dumps(d, indent=1, ensure_ascii=False) + ';\n')
"
```

## Sourcing

Answers about the college use the wording "as published by the college" and name the page. Where published sources disagree (for example the highest placement package), the entry lists the conflict and the assistant shows the range instead of one number.

## Run the tests

Node is needed.

```bash
cd chatbot
node tests/engine-test.js
```

The page itself loads the three files above from `index.html` and needs no build.
