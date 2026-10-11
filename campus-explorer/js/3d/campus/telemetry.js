/*
 * Telemetry
 * =========
 *
 * Records one trace per query through the navigation pipeline, and
 * computes the aggregates a paper needs: context hit rate, grounding
 * success rate, shot distribution, latency percentiles, ambiguity and
 * expired-context counts.
 *
 * WHY IT IS A SEPARATE MODULE
 * The application does not need this. The evaluation does. Keeping it out
 * of the Director and CSM means neither of those modules grows a
 * measurement responsibility they shouldn't have, and it means telemetry
 * can be switched off entirely for a visitor-facing build without
 * touching the pipeline.
 *
 * PRIVACY / ETHICS, since this will be pointed at human participants:
 *   - Nothing is transmitted anywhere. There is no endpoint, no fetch,
 *     no analytics service. Traces live in memory and are lost on reload
 *     unless the operator explicitly exports them.
 *   - Nothing identifies a person. No IP, no fingerprint, no session
 *     cookie, no persistent id. A run is an anonymous ordered list of
 *     queries.
 *   - Query text IS recorded, because analysing which phrasings fail is
 *     the point. Participants must be told that. If a study protocol
 *     forbids it, construct with { recordQueryText: false } and the text
 *     is replaced by its length and word count.
 *
 * DESIGN CONSTRAINT: imports nothing, knows nothing about Three.js or the
 * DOM. Runs in bare Node - tests/telemetry-test.js.
 *
 * HONEST NOTE ON LATENCY: what this measures is pipeline time - intent
 * classification, grounding, shot solving. It does NOT include frame
 * time, camera animation duration, or model loading. Reporting it as
 * "response time" without that qualification would be misleading, since
 * the number is small for reasons that have nothing to do with how long
 * the user waits to see the building.
 */

(function (root, factory) {
	if (typeof module === "object" && module.exports) {
		module.exports = factory();
	} else {
		root.HKBKTelemetry = factory();
	}
}(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	var DEFAULT_CAP = 500;

	function create(options) {
		var opts = options || {};
		return {
			traces: [],
			cap: opts.cap || DEFAULT_CAP,
			recordQueryText: opts.recordQueryText !== false,
			enabled: opts.enabled !== false,
			startedAt: opts.now || Date.now(),
			dropped: 0
		};
	}

	/* One trace per query. Every field is optional except query and
	 * outcome, because a query that matched nothing at all still needs to
	 * appear in the denominator - a log of only the successes would make
	 * every rate look perfect. */
	function record(t, entry) {
		if (!t || !t.enabled) return null;

		var trace = {
			seq: t.traces.length + t.dropped + 1,
			t: (typeof entry.now === "number") ? entry.now : Date.now(),
			outcome: entry.outcome || "unknown",

			intent: entry.intent || null,
			intentConfidence: (typeof entry.intentConfidence === "number") ? entry.intentConfidence : null,
			intentFallback: !!entry.intentFallback,

			contextUsed: !!entry.contextUsed,
			contextKind: entry.contextKind || null,
			contextResolved: (typeof entry.contextResolved === "boolean") ? entry.contextResolved : null,

			building: entry.building || null,
			shot: entry.shot || null,
			shotDegraded: !!entry.shotDegraded,
			fov: (typeof entry.fov === "number") ? entry.fov : null,

			answered: !!entry.answered,
			/* Whether this decision carried a human-readable reason. See
			 * the note on explainabilityRate in summarize(). */
			explained: (typeof entry.explained === "boolean") ? entry.explained : null,
			latencyMs: (typeof entry.latencyMs === "number") ? Math.round(entry.latencyMs * 100) / 100 : null
		};

		if (t.recordQueryText) {
			trace.query = String(entry.query || "");
		} else {
			var q = String(entry.query || "");
			trace.queryLength = q.length;
			trace.queryWords = q.split(/\s+/).filter(Boolean).length;
		}

		t.traces.push(trace);
		/* Ring behaviour: drop oldest, and count the drop so rates stay
		 * honest about being computed over a window. */
		while (t.traces.length > t.cap) {
			t.traces.shift();
			t.dropped++;
		}
		return trace;
	}

	function percentile(sorted, p) {
		if (!sorted.length) return null;
		var idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
		return sorted[idx];
	}

	function tally(list, key) {
		var out = {};
		list.forEach(function (x) {
			var v = x[key];
			if (v === null || v === undefined) return;
			out[v] = (out[v] || 0) + 1;
		});
		return out;
	}

	/* ------------------------------------------------------------------ *
	 * Aggregates
	 *
	 * Rates are reported with their numerator and denominator, not as bare
	 * percentages, so a "100% grounding success" over three queries can be
	 * seen for what it is.
	 * ------------------------------------------------------------------ */
	function summarize(t) {
		var traces = t.traces;
		var n = traces.length;

		var withReference = traces.filter(function (x) { return x.contextKind !== null; });
		var groundedOk = withReference.filter(function (x) { return x.contextResolved === true; });
		var expired = withReference.filter(function (x) { return x.contextResolved === false; });

		var latencies = traces
			.map(function (x) { return x.latencyMs; })
			.filter(function (v) { return typeof v === "number"; })
			.sort(function (a, b) { return a - b; });

		var mean = latencies.length
			? Math.round((latencies.reduce(function (a, b) { return a + b; }, 0) / latencies.length) * 100) / 100
			: null;

		return {
			queries: n,
			droppedFromWindow: t.dropped,
			windowed: t.dropped > 0,

			outcomes: tally(traces, "outcome"),
			intents: tally(traces, "intent"),
			shots: tally(traces, "shot"),
			buildings: tally(traces, "building"),

			contextHitRate: rate(withReference.length, n),
			groundingSuccessRate: rate(groundedOk.length, withReference.length),
			expiredOrUngrounded: expired.length,

			/* Decision Explainability Rate.
			 *
			 * READ THIS BEFORE PUTTING IT IN A PAPER. director.direct()
			 * cannot return without a reason string, so this is expected
			 * to be exactly 1.0 by construction. Reporting "our system
			 * achieves 100% explainability" as a *finding* would be
			 * circular, and a reviewer will say so.
			 *
			 * Its actual value is as a regression check: if it ever falls
			 * below 1.0, some path produced a camera decision with no
			 * explanation attached, which is a bug. Report it as an
			 * invariant that held, not as a result that was achieved.
			 */
			explainabilityRate: rate(
				traces.filter(function (x) { return x.explained === true; }).length,
				traces.filter(function (x) { return x.explained !== null; }).length
			),

			intentFallbacks: traces.filter(function (x) { return x.intentFallback; }).length,
			degradedShots: traces.filter(function (x) { return x.shotDegraded; }).length,
			unanswered: traces.filter(function (x) { return !x.answered; }).length,

			latencyMs: {
				n: latencies.length,
				mean: mean,
				p50: percentile(latencies, 50),
				p95: percentile(latencies, 95),
				max: latencies.length ? latencies[latencies.length - 1] : null
			}
		};
	}

	function rate(num, den) {
		return {
			count: num,
			of: den,
			ratio: den ? Math.round((num / den) * 1000) / 1000 : null
		};
	}

	/* Queries worth a human's attention: nothing matched, intent fell back
	 * to the default, a shot had to be substituted, or a reference could
	 * not be grounded. These are the rows to read when tuning, and the
	 * failure cases a paper should report rather than bury. */
	function problems(t) {
		return t.traces.filter(function (x) {
			return !x.answered
				|| x.intentFallback
				|| x.shotDegraded
				|| x.contextResolved === false
				|| x.explained === false;   /* invariant violation - a bug */
		});
	}

	function toJSON(t, pretty) {
		var payload = {
			schema: "hkbk-telemetry/1",
			startedAt: new Date(t.startedAt).toISOString(),
			exportedAt: new Date().toISOString(),
			queryTextRecorded: t.recordQueryText,
			summary: summarize(t),
			traces: t.traces
		};
		return JSON.stringify(payload, null, pretty ? 2 : 0);
	}

	var CSV_COLUMNS = [
		"seq", "query", "outcome", "intent", "intentConfidence", "intentFallback",
		"contextUsed", "contextKind", "contextResolved", "building", "shot",
		"shotDegraded", "fov", "answered", "explained", "latencyMs"
	];

	function csvCell(v) {
		if (v === null || v === undefined) return "";
		var s = String(v);
		return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	}

	function toCSV(t) {
		var cols = CSV_COLUMNS.filter(function (c) {
			return c !== "query" || t.recordQueryText;
		});
		var lines = [cols.join(",")];
		t.traces.forEach(function (row) {
			lines.push(cols.map(function (c) { return csvCell(row[c]); }).join(","));
		});
		return lines.join("\n");
	}

	function clear(t) {
		t.traces = [];
		t.dropped = 0;
		t.startedAt = Date.now();
		return t;
	}

	return {
		create: create,
		record: record,
		summarize: summarize,
		problems: problems,
		toJSON: toJSON,
		toCSV: toCSV,
		clear: clear,
		CSV_COLUMNS: CSV_COLUMNS
	};
}));
