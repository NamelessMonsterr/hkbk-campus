/* Browser driver for the /eval page. All scoring lives in eval-core.js. */
(function () {
	"use strict";
	function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
	function pctClass(v, good, ok) { return v >= good ? "ok" : (v >= ok ? "warn" : "bad"); }

	var set = window.HKBK_EVAL;
	document.getElementById("banner").textContent =
		set.meta.label + " - " + set.meta.note;

	var lastResults = null;

	function table(headers, rows) {
		var t = el("table");
		var tr = el("tr");
		headers.forEach(function (h) { var th = el("th", null, h.label); if (h.num) th.className = "num"; tr.appendChild(th); });
		t.appendChild(tr);
		rows.forEach(function (r) {
			var tr2 = el("tr"); if (r.cls) tr2.className = r.cls;
			r.cells.forEach(function (c, i) { var td = el("td", headers[i].num ? "num" : null); if (c && c.nodeType) td.appendChild(c); else td.textContent = c; tr2.appendChild(td); });
			t.appendChild(tr2);
		});
		return t;
	}

	function summaryBlock(title, s) {
		var wrap = el("div");
		wrap.appendChild(el("h2", null, title));
		var cards = el("div", "cards");
		function card(v, label, cls) { var c = el("div", "card"); var b = el("b", cls, String(v)); c.appendChild(b); c.appendChild(el("span", null, label)); cards.appendChild(c); }
		var a = s.answerable, u = s.unanswerable;
		card(a.accuracy + "%", "strict accuracy (" + a.n + " answerable)", pctClass(a.accuracy, 80, 60));
		card(a.accuracyWithClarify + "%", "incl. did-you-mean", pctClass(a.accuracyWithClarify, 90, 75));
		card(a.wrongAnswerRate + "%", "wrong-answer rate", a.wrongAnswerRate === 0 ? "ok" : "bad");
		card(u.refusalAccuracy + "%", "refusal accuracy (" + u.n + " unanswerable)", pctClass(u.refusalAccuracy, 85, 60));
		card(u.falseAnswerRate + "%", "false-answer rate", u.falseAnswerRate === 0 ? "ok" : "bad");
		card(s.latency.p50 + " ms", "latency p50 (mean " + s.latency.mean + ", p95 " + s.latency.p95 + ", max " + s.latency.max + ")", null);
		wrap.appendChild(cards);
		var rows = Object.keys(s.byCategory).sort().map(function (c) {
			var x = s.byCategory[c];
			return { cells: [c, x.n, x.correct, x.clarified_correct, x.wrong_answer, x.missed_refusal, x.clarified_wrong] };
		});
		wrap.appendChild(table(
			[{ label: "category" }, { label: "n", num: 1 }, { label: "correct", num: 1 }, { label: "did-you-mean ok", num: 1 }, { label: "wrong", num: 1 }, { label: "refused", num: 1 }, { label: "clarify missed", num: 1 }],
			rows));
		return wrap;
	}

	function run() {
		var status = document.getElementById("status");
		status.textContent = "running...";
		setTimeout(function () {
			var t0 = performance.now();
			var engine = new window.HKBKChat.Engine(window.HKBK_KB);
			var buildMs = Math.round((performance.now() - t0) * 100) / 100;
			var now = function () { return performance.now(); };
			var results = window.HKBKEval.run(engine, set.questions, now);
			lastResults = results;

			var out = document.getElementById("out");
			out.innerHTML = "";
			out.appendChild(el("p", "sub", "index build " + buildMs + " ms - " + engine.stats().chunks + " chunks, vocab " + engine.stats().vocabulary +
				" - engine config: clarifyFloor " + engine.config.clarifyFloor + ", answerFloor " + engine.config.answerFloor +
				", margin " + engine.config.ambiguityMargin + ", coverage penalty " + (engine.config.coveragePenalty ? "on" : "off")));

			["dev", "test"].forEach(function (split) {
				var rs = results.filter(function (r) { return r.split === split; });
				out.appendChild(summaryBlock(split + " split (" + rs.length + " questions)", window.HKBKEval.summarise(rs)));
			});

			out.appendChild(el("h2", null, "coverage vs accuracy (test split, single hard floor)"));
			var curve = window.HKBKEval.coverageCurve(window.HKBKChat.Engine, window.HKBK_KB, set.questions.filter(function (q) { return q.split === "test"; }), now);
			out.appendChild(table(
				[{ label: "floor", num: 1 }, { label: "coverage %", num: 1 }, { label: "accuracy %", num: 1 }],
				curve.map(function (p) { return { cells: [p.threshold.toFixed(2), p.coverage, p.accuracy] }; })));

			out.appendChild(el("h2", null, "every question"));
			var det = el("details");
			det.appendChild(el("summary", null, "show all " + results.length + " results"));
			det.appendChild(table(
				[{ label: "id" }, { label: "split" }, { label: "question" }, { label: "expected" }, { label: "got" }, { label: "conf", num: 1 }, { label: "outcome" }, { label: "ms", num: 1 }],
				results.map(function (r) {
					var exp = r.expect.entry ? (typeof r.expect.entry === "string" ? r.expect.entry : r.expect.entry.join(" | ")) : "REFUSE";
					var got = r.entryId || (r.suggestions.length ? "clarify: " + r.suggestions.join(", ") : r.type);
					var bad = ["wrong_answer", "missed_refusal", "clarified_wrong", "false_answer", "false_clarify"].indexOf(r.outcome) !== -1;
					return { cls: bad ? "fail" : (r.type === "clarify" ? "clar" : ""), cells: [r.id, r.split, r.q, exp, got, r.confidence, r.outcome, r.ms] };
				})));
			out.appendChild(det);

			document.getElementById("csv").disabled = false;
			status.textContent = "done - " + results.length + " questions";
		}, 30);
	}

	function csv() {
		if (!lastResults) return;
		var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
		var lines = ["id,split,category,question,expected,type,got,confidence,outcome,ms"];
		lastResults.forEach(function (r) {
			var exp = r.expect.entry ? (typeof r.expect.entry === "string" ? r.expect.entry : r.expect.entry.join("|")) : "REFUSE";
			var got = r.entryId || (r.suggestions.length ? "clarify:" + r.suggestions.join("|") : r.type);
			lines.push([r.id, r.split, r.category, q(r.q), q(exp), r.type, q(got), r.confidence, r.outcome, r.ms].join(","));
		});
		var blob = new Blob([lines.join("\n")], { type: "text/csv" });
		var a = el("a");
		a.href = URL.createObjectURL(blob);
		a.download = "hkbk-eval-results.csv";
		a.click();
		URL.revokeObjectURL(a.href);
	}

	document.getElementById("run").addEventListener("click", run);
	document.getElementById("csv").addEventListener("click", csv);
	run();
})();
