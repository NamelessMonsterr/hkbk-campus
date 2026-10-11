/*
 * Tests for the telemetry layer.
 *
 *   node tests/telemetry-test.js
 */

var T = require("../js/3d/campus/telemetry.js");

var passed = 0, failed = 0;
function ok(label, cond) {
	if (cond) { passed++; console.log("  PASS  " + label); }
	else { failed++; console.log("  FAIL  " + label); }
}
function section(name) {
	console.log("\n== " + name + " " + Array(Math.max(2, 62 - name.length)).join("="));
}

function entry(over) {
	var base = {
		query: "take me to the library", outcome: "navigated",
		intent: "navigation", intentConfidence: 0.9, intentFallback: false,
		contextUsed: false, contextKind: null, contextResolved: null,
		building: "library", shot: "entrance", shotDegraded: false, fov: 46,
		answered: true, latencyMs: 4.2, now: 1000
	};
	Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
	return base;
}

section("Recording");
var t = T.create();
var rec = T.record(t, entry());
ok("a recorded trace comes back", rec !== null);
ok("traces are sequenced", rec.seq === 1);
ok("query text is recorded by default", rec.query === "take me to the library");
ok("intent is captured", rec.intent === "navigation");
ok("shot is captured", rec.shot === "entrance");
ok("latency is captured", rec.latencyMs === 4.2);

T.record(t, entry({ query: "second" }));
ok("sequence increments", t.traces[1].seq === 2);

section("Disabled and privacy modes");
var off = T.create({ enabled: false });
ok("a disabled recorder records nothing", T.record(off, entry()) === null && off.traces.length === 0);

var anon = T.create({ recordQueryText: false });
var anonRec = T.record(anon, entry({ query: "where is the placement cell" }));
ok("query text is omitted when disabled", anonRec.query === undefined);
ok("but its length is kept", anonRec.queryLength === "where is the placement cell".length);
ok("and its word count is kept", anonRec.queryWords === 5);
ok("CSV omits the query column in anonymous mode", T.toCSV(anon).split("\n")[0].indexOf("query") === -1);
ok("JSON records which mode was used", JSON.parse(T.toJSON(anon)).queryTextRecorded === false);

section("Failures are counted, not dropped");
var f = T.create();
T.record(f, entry());
T.record(f, entry({ outcome: "no_match", intent: null, building: null, shot: null, answered: false }));
T.record(f, entry({ intentFallback: true }));
T.record(f, entry({ shotDegraded: true }));
var s = T.summarize(f);
ok("unanswered queries appear in the total", s.queries === 4);
ok("unanswered queries are counted", s.unanswered === 1);
ok("intent fallbacks are counted", s.intentFallbacks === 1);
ok("degraded shots are counted", s.degradedShots === 1);

var probs = T.problems(f);
ok("problems() surfaces every non-clean query", probs.length === 3);

section("Context metrics");
var c = T.create();
T.record(c, entry({ contextKind: null }));                                        /* no reference */
T.record(c, entry({ contextUsed: true, contextKind: "self", contextResolved: true }));
T.record(c, entry({ contextUsed: true, contextKind: "nearby", contextResolved: true }));
T.record(c, entry({ contextUsed: false, contextKind: "self", contextResolved: false }));
var cs = T.summarize(c);
ok("context hit rate counts queries carrying a reference", cs.contextHitRate.count === 3);
ok("context hit rate is over all queries", cs.contextHitRate.of === 4);
ok("context hit ratio is computed", cs.contextHitRate.ratio === 0.75);
ok("grounding success is over referencing queries only", cs.groundingSuccessRate.of === 3);
ok("grounding success counts resolved references", cs.groundingSuccessRate.count === 2);
ok("ungrounded references are counted separately", cs.expiredOrUngrounded === 1);

section("Decision explainability (invariant, not a finding)");
var x = T.create();
T.record(x, entry({ explained: true }));
T.record(x, entry({ explained: true }));
T.record(x, entry({ explained: undefined }));      /* no decision to explain */
var xs = T.summarize(x);
ok("explainability counts only queries that made a decision", xs.explainabilityRate.of === 2);
ok("explainability is 1.0 when every decision carried a reason", xs.explainabilityRate.ratio === 1);

T.record(x, entry({ explained: false }));          /* would be a bug */
ok("an unexplained decision drops the rate below 1",
	T.summarize(x).explainabilityRate.ratio < 1);
ok("an unexplained decision is surfaced as a problem",
	T.problems(x).some(function (r) { return r.explained === false; }));
ok("explained is a CSV column", T.CSV_COLUMNS.indexOf("explained") !== -1);

section("Rates report numerator and denominator");
ok("rates are not bare percentages",
	typeof cs.contextHitRate.count === "number" && typeof cs.contextHitRate.of === "number");
var empty = T.summarize(T.create());
ok("an empty recorder yields a null ratio rather than NaN", empty.contextHitRate.ratio === null);
ok("an empty recorder reports zero queries", empty.queries === 0);

section("Distributions");
var d = T.create();
["entrance", "entrance", "detail", "overview"].forEach(function (shot) {
	T.record(d, entry({ shot: shot }));
});
var ds = T.summarize(d);
ok("shot distribution counts repeats", ds.shots.entrance === 2);
ok("shot distribution covers all shots", Object.keys(ds.shots).length === 3);
ok("intent distribution is produced", ds.intents.navigation === 4);

section("Latency");
var l = T.create();
[1, 2, 3, 4, 100].forEach(function (ms) { T.record(l, entry({ latencyMs: ms })); });
var ls = T.summarize(l).latencyMs;
ok("latency count matches", ls.n === 5);
ok("median resists the outlier", ls.p50 === 3);
ok("p95 captures the tail", ls.p95 === 100);
ok("max is reported", ls.max === 100);
ok("mean is reported", ls.mean === 22);

var noLatency = T.create();
T.record(noLatency, entry({ latencyMs: undefined }));
ok("missing latency does not corrupt the summary", T.summarize(noLatency).latencyMs.n === 0);

section("Windowing is disclosed");
var w = T.create({ cap: 3 });
for (var i = 0; i < 5; i++) T.record(w, entry({ query: "q" + i }));
ok("the window holds only cap traces", w.traces.length === 3);
ok("dropped traces are counted", w.dropped === 2);
ok("the summary discloses that it is windowed", T.summarize(w).windowed === true);
ok("sequence numbers survive dropping", w.traces[0].seq === 3);

section("Export");
var e = T.create();
T.record(e, entry({ query: 'has "quotes", and a comma' }));
var csv = T.toCSV(e);
ok("CSV has a header", csv.split("\n")[0].indexOf("seq,query,outcome") === 0);
ok("CSV escapes quotes and commas", csv.split("\n")[1].indexOf('"has ""quotes"", and a comma"') !== -1);
ok("CSV has one row per trace", csv.trim().split("\n").length === 2);

var json = JSON.parse(T.toJSON(e, true));
ok("JSON export is versioned", json.schema === "hkbk-telemetry/1");
ok("JSON export carries the summary", typeof json.summary.queries === "number");
ok("JSON export carries the raw traces", json.traces.length === 1);
ok("JSON export timestamps the run", typeof json.startedAt === "string");

section("Clearing");
T.clear(e);
ok("clear empties traces", e.traces.length === 0);
ok("clear resets the drop count", e.dropped === 0);

console.log("\n== Result ====================================================");
console.log("  " + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
