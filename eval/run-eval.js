/*
 * Node runner for the frozen question set.
 *
 *   node eval/run-eval.js              run with the engine's shipped config
 *   node eval/run-eval.js --sweep      grid-search the refusal floors on the
 *                                      dev split, then score the winner on test
 *   node eval/run-eval.js --compare    retriever baseline comparison on the
 *                                      held-out test split (all LLM-free)
 *   node eval/run-eval.js --csv out.csv --json out.json
 *
 * Exit code 1 if any regression vs expectations is found, so this can run as
 * a gate. Prints the same tables the /eval page renders in the browser.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var perf = (typeof performance !== "undefined" && performance.now) ? performance : require("perf_hooks").performance;

var ROOT = path.join(__dirname, "..");
var kb = JSON.parse(fs.readFileSync(path.join(ROOT, "campus-explorer", "data", "knowledge-base.json"), "utf8"));
/* --questions <file> runs an alternate set (e.g. questions-kn.json); the
 * default remains questions.json */
var args0 = process.argv.slice(2);
var qi = args0.indexOf("--questions");
var set = JSON.parse(fs.readFileSync(path.join(__dirname, qi !== -1 ? args0[qi + 1] : "questions.json"), "utf8"));
var HKBKChat = require(path.join(ROOT, "campus-explorer", "js", "chatbot-engine.js"));
var EV = require(path.join(__dirname, "eval-core.js"));

var args = process.argv.slice(2);
function flag(name) { return args.indexOf(name) !== -1; }
function opt(name) { var i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; }

var now = function () { return perf.now(); };

function bar(label, val, width) {
	var n = Math.round((val / 100) * (width || 20));
	return label + " " + "#".repeat(n) + "-".repeat((width || 20) - n) + " " + val + "%";
}

function printSummary(title, s) {
	console.log("\n== " + title + " " + "=".repeat(Math.max(0, 62 - title.length)));
	var a = s.answerable, u = s.unanswerable;
	console.log("answerable questions: " + a.n);
	console.log("  " + bar("strict accuracy   ", a.accuracy));
	console.log("  " + bar("incl. did-you-mean", a.accuracyWithClarify));
	console.log("  " + bar("wrong-answer rate ", a.wrongAnswerRate));
	console.log("  outcomes: " + JSON.stringify(a.counts));
	console.log("unanswerable questions: " + u.n);
	console.log("  " + bar("refusal accuracy  ", u.refusalAccuracy));
	console.log("  " + bar("false-answer rate ", u.falseAnswerRate));
	console.log("  outcomes: " + JSON.stringify(u.counts));
	console.log("latency ms: mean " + s.latency.mean + "  p50 " + s.latency.p50 + "  p95 " + s.latency.p95 + "  max " + s.latency.max);
	console.log("per category (answerable):");
	Object.keys(s.byCategory).sort().forEach(function (c) {
		var x = s.byCategory[c];
		console.log("  " + (c + "                    ").slice(0, 20) +
			" n=" + x.n + " correct=" + x.correct + " clarified=" + x.clarified_correct +
			" wrong=" + x.wrong_answer + " refused=" + x.missed_refusal);
	});
}

function failures(results) {
	return results.filter(function (r) {
		return ["wrong_answer", "missed_refusal", "clarified_wrong", "false_answer", "false_clarify"].indexOf(r.outcome) !== -1;
	});
}

function printFailures(results) {
	var bad = failures(results);
	if (!bad.length) { console.log("\nno failing questions"); return; }
	/* failures are not equal: a wrong answer or a nonsense question answered
	 * as fact is dangerous, a missed answer is a recall gap, a false clarify
	 * is a boundary annoyance. Say which is which. */
	var byClass = {};
	bad.forEach(function (b) { byClass[b.outcome] = (byClass[b.outcome] || 0) + 1; });
	console.log("\nfailure classes: " + Object.keys(byClass).sort().map(function (k) {
		return k + "=" + byClass[k];
	}).join(" ") +
		((byClass.wrong_answer || byClass.false_answer) ? "  <-- RELEASE BLOCKER" : "  (no wrong/false answers: not a release blocker)"));
	console.log("\n== failing questions (" + bad.length + ") " + "=".repeat(42));
	bad.forEach(function (r) {
		console.log("  [" + r.outcome + "] " + r.q +
			"  -> got " + (r.entryId || (r.suggestions.length ? "clarify:" + r.suggestions.join(",") : r.type)) +
			" (conf " + r.confidence + ")");
	});
}

if (flag("--compare")) {
	// Same frozen questions, same refusal floors, four scorers. Every one is
	// LLM-free: no external model, no network call, no API key. The shipped
	// config (tfidf + repair) is the first row so the others read as deltas.
	var configs = [
		{ label: "tfidf + repair (shipped)", config: {} },
		{ label: "bm25 + repair", config: { retriever: "bm25" } },
		{ label: "tfidf, no repair", config: { repair: false } },
		{ label: "bm25, no repair", config: { retriever: "bm25", repair: false } }
	];
	var splits = ["dev", "test"];
	splits.forEach(function (sp) {
		var qs = set.questions.filter(function (q) { return q.split === sp; });
		var rows = EV.compare(HKBKChat.Engine, kb, qs, configs, now);
		console.log("\n== retriever comparison, " + sp + " split (" + qs.length + " questions, all LLM-free) ==");
		console.log(("config").padEnd(26) + "acc%   acc+clar%  wrong%  refuse%  false%  R@1%   R@3%   MRR    p50ms");
		rows.forEach(function (r) {
			var s = r.summary;
			console.log(r.label.padEnd(26) +
				String(s.accuracy).padEnd(7) + String(s.accuracyWithClarify).padEnd(11) +
				String(s.wrongAnswerRate).padEnd(8) + String(s.refusalAccuracy).padEnd(9) +
				String(s.falseAnswerRate).padEnd(8) + String(s.recallAt1).padEnd(7) +
				String(s.recallAt3).padEnd(7) + String(s.mrr).padEnd(7) + s.latencyP50);
		});
	});
	console.log("\nNOTE: dev split tuned the shipped floors; the test split is the held-out headline.");
	process.exit(0);
}

var t0 = now();
var engine = new HKBKChat.Engine(kb);
var buildMs = Math.round((now() - t0) * 100) / 100;

console.log("HKBK chatbot eval - " + set.meta.label);
console.log("question set: " + set.questions.length + " questions (" +
	set.questions.filter(function (q) { return q.split === "dev"; }).length + " dev / " +
	set.questions.filter(function (q) { return q.split === "test"; }).length + " test)");
console.log("index build: " + buildMs + " ms, " + engine.stats().chunks + " chunks, vocab " + engine.stats().vocabulary);

if (flag("--sweep")) {
	var dev = set.questions.filter(function (q) { return q.split === "dev"; });
	console.log("\nsweeping refusal floors on the dev split (" + dev.length + " questions)...");
	var rows = EV.sweep(HKBKChat.Engine, kb, dev, now);
	console.log("top 10 configs by objective (wrong answers cost 3):");
	rows.slice(0, 10).forEach(function (r) {
		console.log("  score " + String(r.score).padStart(6) + "  hard " + r.hardCorrect + "/" + dev.length +
			"  clarifyFloor=" + r.config.clarifyFloor + " answerFloor=" + r.config.answerFloor +
			" margin=" + r.config.ambiguityMargin);
	});
	var best = rows[0].config;
	console.log("\nwinner: " + JSON.stringify(best));
	console.log("NOTE: if this differs from the shipped CONFIG, update CONFIG in chatbot-engine.js and say so in eval/README.md");

	console.log("\n-- winner scored on the held-out test split --");
	var test = set.questions.filter(function (q) { return q.split === "test"; });
	var testEngine = new HKBKChat.Engine(kb, best);
	var testResults = EV.run(testEngine, test, now);
	printSummary("test split, tuned config", EV.summarise(testResults));
	printFailures(testResults);
	var csvPath = opt("--csv"), jsonPath = opt("--json");
	if (csvPath) writeCsv(csvPath, testResults);
	if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ config: best, split: "test", results: testResults }, null, 1));
	process.exit(failures(testResults).length ? 1 : 0);
}

var results = EV.run(engine, set.questions, now);
/* alternate sets without a dev/test split (the small Kannada smoke set) run
 * as a single block - no tuning/held-out semantics are claimed for them */
var hasDevTest = set.questions.some(function (q) { return q.split === "dev" || q.split === "test"; });
var devResults = results.filter(function (r) { return r.split === "dev"; });
var testResults = results.filter(function (r) { return r.split === "test"; });

if (hasDevTest) {
	printSummary("dev split, shipped config", EV.summarise(devResults));
	printSummary("test split, shipped config", EV.summarise(testResults));
} else {
	printSummary("whole set, shipped config", EV.summarise(results));
}

if (hasDevTest) {
	console.log("\n== coverage vs accuracy (test split, single hard floor) ==");
	EV.coverageCurve(HKBKChat.Engine, kb, set.questions.filter(function (q) { return q.split === "test"; }), now)
		.forEach(function (p) {
			console.log("  floor " + p.threshold.toFixed(2) + "  coverage " + String(p.coverage).padStart(5) + "%  accuracy " + p.accuracy + "%");
		});
}

printFailures(results);

var csvPath = opt("--csv"), jsonPath = opt("--json");
if (csvPath) writeCsv(csvPath, results);
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ config: engine.config, results: results }, null, 1));

function writeCsv(p2, rows) {
	var head = "id,split,category,question,expected,type,got,confidence,outcome,ms";
	var lines = rows.map(function (r) {
		var exp = r.expect.entry ? (typeof r.expect.entry === "string" ? r.expect.entry : r.expect.entry.join("|")) : "REFUSE";
		var got = r.entryId || (r.suggestions.length ? "clarify:" + r.suggestions.join("|") : r.type);
		return [r.id, r.split, r.category, csvq(r.q), csvq(exp), r.type, csvq(got), r.confidence, r.outcome, r.ms].join(",");
	});
	fs.writeFileSync(p2, head + "\n" + lines.join("\n") + "\n");
	console.log("\nwrote " + p2);
}
function csvq(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

process.exit(failures(results).length ? 1 : 0);
