/*
 * HKBK chatbot evaluation harness - shared core.
 *
 * Runs a frozen question set through the real engine and scores each answer.
 * Used by eval/run-eval.js (Node) and eval/index.html (browser); the page and
 * the script must agree, so the scoring lives here exactly once.
 *
 * Outcomes for answerable questions (expect.entry):
 *   correct            answered with the expected entry
 *   clarified_correct  "did you mean" offered the expected entry
 *   clarified_wrong    "did you mean" missed it
 *   wrong_answer       answered with a different entry (the worst outcome)
 *   missed_refusal     refused a question it should have answered
 * Outcomes for unanswerable questions (expect.refuse):
 *   correct_refusal    refused, as it should
 *   false_clarify      asked "did you mean" on nonsense
 *   false_answer       answered nonsense (the worst outcome)
 */
(function (global) {
	"use strict";

	function acceptable(expect) {
		var e = expect && expect.entry;
		if (!e) return null;
		return typeof e === "string" ? [e] : e;
	}

	function scoreOne(res, expect) {
		var ok = acceptable(expect);
		if (ok) {
			if (res.type === "answer") return ok.indexOf(res.entryId) !== -1 ? "correct" : "wrong_answer";
			if (res.type === "clarify") {
				var ids = (res.suggestions || []).map(function (s) { return s.entryId; });
				for (var i = 0; i < ok.length; i++) if (ids.indexOf(ok[i]) !== -1) return "clarified_correct";
				return "clarified_wrong";
			}
			return "missed_refusal";
		}
		if (res.type === "out_of_scope") return "correct_refusal";
		if (res.type === "clarify") return "false_clarify";
		return "false_answer";
	}

	// endSession() between questions: the eval set is a bag of independent
	// questions, and the 10-turn memory must not leak one question's topic
	// into the next.
	function run(engine, questions, nowFn) {
		var now = nowFn || function () { return Date.now(); };
		return questions.map(function (qq) {
			if (engine.endSession) engine.endSession();
			var t0 = now();
			var res = engine.ask(qq.q);
			var ms = now() - t0;
			var conf = res.confidence;
			// a refusal carries confidence 0 by design; recover the score that
			// fell under the floor from the trace so failures display honestly
			if (res.type === "out_of_scope" && res.trace && res.trace.steps) {
				res.trace.steps.forEach(function (st) {
					if (st.step === "confidence_floor") conf = st.confidence;
				});
			}
			return {
				id: qq.id,
				q: qq.q,
				category: qq.category,
				split: qq.split,
				expect: qq.expect,
				type: res.type,
				entryId: res.entryId || null,
				suggestions: (res.suggestions || []).map(function (s) { return s.entryId; }),
				confidence: conf,
				outcome: scoreOne(res, qq.expect),
				ms: Math.round(ms * 100) / 100
			};
		});
	}

	var ANSWERABLE = ["correct", "clarified_correct", "clarified_wrong", "wrong_answer", "missed_refusal"];
	var UNANSWERABLE = ["correct_refusal", "false_clarify", "false_answer"];

	function countBy(results, outcomes) {
		var c = {};
		outcomes.forEach(function (o) { c[o] = 0; });
		results.forEach(function (r) { if (r.outcome in c) c[r.outcome]++; });
		return c;
	}

	function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : 0; }

	function percentile(sorted, p) {
		if (!sorted.length) return 0;
		var i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
		return sorted[i];
	}

	function summarise(results) {
		var ans = results.filter(function (r) { return acceptable(r.expect); });
		var un = results.filter(function (r) { return !acceptable(r.expect); });
		var ca = countBy(ans, ANSWERABLE);
		var cu = countBy(un, UNANSWERABLE);
		var lat = results.map(function (r) { return r.ms; }).sort(function (a, b) { return a - b; });
		var byCat = {};
		ans.forEach(function (r) {
			var c = byCat[r.category] || (byCat[r.category] = { n: 0, correct: 0, clarified_correct: 0, wrong_answer: 0, missed_refusal: 0, clarified_wrong: 0 });
			c.n++;
			c[r.outcome]++;
		});
		return {
			answerable: {
				n: ans.length,
				counts: ca,
				accuracy: pct(ca.correct, ans.length),
				accuracyWithClarify: pct(ca.correct + ca.clarified_correct, ans.length),
				wrongAnswerRate: pct(ca.wrong_answer, ans.length)
			},
			unanswerable: {
				n: un.length,
				counts: cu,
				refusalAccuracy: pct(cu.correct_refusal, un.length),
				falseAnswerRate: pct(cu.false_answer, un.length)
			},
			latency: {
				mean: Math.round((lat.reduce(function (a, b) { return a + b; }, 0) / (lat.length || 1)) * 100) / 100,
				p50: percentile(lat, 50),
				p95: percentile(lat, 95),
				max: lat.length ? lat[lat.length - 1] : 0
			},
			byCategory: byCat
		};
	}

	// Coverage-vs-accuracy: re-run the answerable set with a single hard floor
	// (no clarify band, no margin) swept from 0 to max. This is the selectivity
	// curve a reviewer asks for: how much we answer vs how right we are when we do.
	function coverageCurve(EngineClass, kb, questions, nowFn) {
		var ans = questions.filter(function (q) { return acceptable(q.expect); });
		var pts = [];
		for (var t = 0; t <= 0.60; t += 0.05) {
			var engine = new EngineClass(kb, { answerFloor: t, clarifyFloor: t, ambiguityMargin: 0 });
			var results = run(engine, ans, nowFn);
			var answered = results.filter(function (r) { return r.type === "answer"; });
			var correct = answered.filter(function (r) { return r.outcome === "correct"; }).length;
			pts.push({
				threshold: Math.round(t * 100) / 100,
				coverage: pct(answered.length, ans.length),
				accuracy: pct(correct, answered.length)
			});
		}
		return pts;
	}

	// Grid search over the refusal-band knobs, scored on whatever split the
	// caller passes (the dev split - never the test split).
	// Wrong answers and false answers cost 3: they are the outcomes a reviewer
	// punishes. A missed answer costs 1. A wrong or misplaced clarify costs 1.
	function sweep(EngineClass, kb, questions, nowFn) {
		var WRONG = 3, MISS = 1, BADCLARIFY = 1, CLARIFY_CREDIT = 0.9;
		function objective(results) {
			var s = 0;
			results.forEach(function (r) {
				switch (r.outcome) {
					case "correct": s += 1; break;
					case "clarified_correct": s += CLARIFY_CREDIT; break;
					case "correct_refusal": s += 1; break;
					case "wrong_answer": s -= WRONG; break;
					case "false_answer": s -= WRONG; break;
					case "missed_refusal": s -= MISS; break;
					case "clarified_wrong": s -= BADCLARIFY; break;
					case "false_clarify": s -= BADCLARIFY; break;
				}
			});
			return Math.round(s * 100) / 100;
		}
		var rows = [];
		var margins = [0, 0.03, 0.06];
		var coverages = [true, false];
		for (var cov = 0; cov < coverages.length; cov++)
		for (var cf = 0.08; cf <= 0.3001; cf += 0.02) {
			for (var af = cf + 0.02; af <= 0.4501; af += 0.02) {
				for (var m = 0; m < margins.length; m++) {
					var cfg = { clarifyFloor: Math.round(cf * 100) / 100, answerFloor: Math.round(af * 100) / 100, ambiguityMargin: margins[m], coveragePenalty: coverages[cov] };
					var engine = new EngineClass(kb, cfg);
					var results = run(engine, questions, nowFn);
					var sc = objective(results);
					var hard = results.filter(function (r) { return r.outcome === "correct" || r.outcome === "correct_refusal"; }).length;
					rows.push({ config: cfg, score: sc, hardCorrect: hard });
				}
			}
		}
		rows.sort(function (a, b) {
			if (b.score !== a.score) return b.score - a.score;
			if (b.hardCorrect !== a.hardCorrect) return b.hardCorrect - a.hardCorrect;
			if (b.config.clarifyFloor !== a.config.clarifyFloor) return b.config.clarifyFloor - a.config.clarifyFloor;
			if (a.config.answerFloor !== b.config.answerFloor) return a.config.answerFloor - b.config.answerFloor;
			return (b.config.coveragePenalty ? 1 : 0) - (a.config.coveragePenalty ? 1 : 0);
		});
		return rows;
	}

	var api = {
		run: run,
		summarise: summarise,
		coverageCurve: coverageCurve,
		sweep: sweep,
		scoreOne: scoreOne
	};
	global.HKBKEval = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : this));
