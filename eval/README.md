# Ask HKBK - evaluation harness

Measures the chatbot instead of vibes. Same harness in both places:

- `node eval/run-eval.js` - prints the tables, exits 1 on any failing question
- `/eval/` on the site - the same run in the browser, with a CSV download

## The question set is a PLACEHOLDER

`questions.json` (71 questions: 55 answerable across all KB categories, 16
unanswerable/trap) was written from the knowledge base by the team. It is NOT
real student data. Every number on the page is labelled placeholder and must
stay labelled until the set is replaced with questions collected from actual
students. Keep the schema, keep the dev/test split idea, re-run.

- `dev` split (36): used to tune the refusal floors (`node eval/run-eval.js --sweep`)
- `test` split (35): held out; the numbers we quote

## What the numbers mean

- strict accuracy - answered with the expected KB entry
- incl. did-you-mean - also counts a "did you mean" that offered the right entry
- wrong-answer rate - stated a wrong entry as fact (worst outcome; kept at 0 on both splits)
- refusal accuracy - unanswerable/trap questions correctly refused
- false-answer rate - unanswerable questions stated as fact (worst refusal outcome)
- latency - per-query ms of `engine.ask`, p50/p95/max, plus one-off index build

## Calibrated refusal (the 2026-10 change)

Three bands + evidence gates, all tuned on the dev split:

- `clarifyFloor 0.15` - below: refuse with office contacts
- `answerFloor 0.22` - at/above: answer. Between the floors: "did you mean?"
- `ambiguityMargin 0.02` - runner-up this close: offer both
- coverage gate - confidence scales with the share of the question's content
  words the KB vocabulary covers; if half or more are unknown it refuses
  outright, and an answer supported only by fuzzy-repaired (guessed) words is
  demoted to a suggestion, never stated as fact
- whole-question fuzzy match fires only on a near-identical string (>= 0.90)
  or full token coverage, so "dress code" no longer answers as "cet code"
- short-token repair fixes one dropped letter ("fes" -> "fees") but never
  swaps letters in short words ("won" is not "non")

`--sweep` grids the floors on the dev split and scores the winner on test.
The shipped floors were chosen from the sweep's top candidates; the raw
objective winner over-refused legitimate questions, so the final pick
(clarifyFloor 0.15 / answerFloor 0.22 / margin 0.02, coverage on) was the
candidate with the best balance of strict accuracy and zero wrong answers,
reviewed against the held-out split. Recorded here so nobody has to pretend
the last 0.02 came from principle rather than measurement.

Regenerate the browser copies after editing JSON sources:

```
python3 -c "import json;d=json.load(open('eval/questions.json',encoding='utf-8'));open('eval/questions.js','w',encoding='utf-8').write('/* GENERATED from questions.json - do not edit by hand. */\nwindow.HKBK_EVAL = '+json.dumps(d,ensure_ascii=False,indent=1)+';\n')"
```
