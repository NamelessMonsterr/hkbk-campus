/*
 * Node test harness for the conversation layer (js/conversation.js).
 * Run: node tests/conversation-test.js
 *
 * Proves the rules the feature lives by: offline is the default and every
 * failure path; facts come only from the engine; one call per turn, never a
 * retry; history stays in the session and dies with it.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var ROOT = path.join(__dirname, "..");
var kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "knowledge-base.json"), "utf8"));
var HKBKChat = require(path.join(ROOT, "js", "chatbot-engine.js"));
var HKBKTalk = require(path.join(ROOT, "js", "conversation.js"));

var pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

function mockFetchOk(reply) {
	var calls = [];
	var fn = function (url, opts) {
		calls.push({ url: url, body: JSON.parse(opts.body) });
		return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ reply: reply }); } });
	};
	fn.calls = calls;
	return fn;
}
function mockFetchStatus(status) {
	var calls = 0;
	var fn = function () { calls++; return Promise.resolve({ ok: false, status: status, json: function () { return Promise.resolve({}); } }); };
	fn.count = function () { return calls; };
	return fn;
}
function mockFetchHang() {
	var calls = 0;
	var fn = function (url, opts) {
		calls++;
		return new Promise(function (resolve, reject) {
			if (opts && opts.signal) opts.signal.addEventListener("abort", function () { reject(new Error("aborted")); });
		});
	};
	fn.count = function () { return calls; };
	return fn;
}

function conv(fetchImpl, config) {
	var engine = new HKBKChat.Engine(kb);
	return HKBKTalk.createConversation({
		engine: engine,
		fetchImpl: fetchImpl,
		config: config || { endpoint: "https://proxy.example/talk", timeoutMs: 120, historyTurns: 6 }
	});
}

var tests = [
	function () {
		section("Offline default");
		var c = HKBKTalk.createConversation({ engine: new HKBKChat.Engine(kb), fetchImpl: mockFetchOk("x"), config: { endpoint: "" } });
		check("empty endpoint -> offline", c.isOnline() === false);
		var fetchNever = mockFetchOk("x");
		var c2 = conv(fetchNever, { endpoint: "" });
		return c2.reply("what is the hostel fee").then(function (r) {
			check("offline mode reported", r.mode === "offline");
			check("no network call in offline mode", fetchNever.calls.length === 0);
			check("offline text is the KB answer verbatim", r.text === r.engine.answer);
		});
	},
	function () {
		section("Online phrasing");
		var f = mockFetchOk("Hostel fees depend on the block; the office has the current figure.");
		var c = conv(f);
		check("configured endpoint -> online", c.isOnline() === true);
		return c.reply("what is the hostel fee").then(function (r) {
			check("online mode reported", r.mode === "online");
			check("speaks the proxy reply", r.text.indexOf("Hostel fees") === 0);
			var body = f.calls[0].body;
			check("payload carries the question", body.question === "what is the hostel fee");
			check("payload carries engine outcome", body.outcome === "answer");
			check("facts are the retrieved KB answer", body.facts.length === 1 && body.facts[0].text === r.engine.answer);
			check("kb version travels", typeof body.kbVersion === "string" && body.kbVersion.length > 0);
			check("history kept after online turn", c.history().length === 1 && c.history()[0].user === "what is the hostel fee");
		});
	},
	function () {
		section("Out-of-scope stays honest online");
		var f = mockFetchOk("I don't have that; here is the office number.");
		var c = conv(f);
		return c.reply("what is the capital of France").then(function (r) {
			var body = f.calls[0].body;
			check("outcome is out_of_scope", body.outcome === "out_of_scope");
			check("no facts offered to the model", body.facts.length === 0);
			check("KB refusal text travels for the model to reuse", typeof body.refusal === "string" && body.refusal.length > 10);
			check("office contacts travel", body.handoff && body.handoff.reception);
		});
	},
	function () {
		section("Failures fall back offline, one call only");
		var f429 = mockFetchStatus(429);
		var c = conv(f429);
		return c.reply("what is the hostel fee").then(function (r) {
			check("429 -> offline answer", r.mode === "offline" && r.text === r.engine.answer);
			check("exactly one request, no retry", f429.count() === 1);
			check("error recorded", r.onlineError === "http_429");
		}).then(function () {
			var hang = mockFetchHang();
			var c2 = conv(hang);
			return c2.reply("where is the admin block").then(function (r) {
				check("timeout -> offline answer", r.mode === "offline" && r.onlineError === "timeout");
				check("timeout made exactly one request", hang.count() === 1);
			});
		});
	},
	function () {
		section("Session hygiene");
		var c = conv(mockFetchOk("fine"));
		return c.reply("hostel fee?").then(function () {
			check("history has the turn", c.history().length === 1);
			c.clear();
			check("clear() empties history", c.history().length === 0);
		});
	},
	function () {
		section("Clarify band online");
		var f = mockFetchOk("Did you mean the hostel fee or the placements?");
		var c = conv(f);
		return c.reply("hostel feez and placemants").then(function (r) {
			var body = f.calls[0].body;
			if (body.outcome === "clarify") {
				check("clarify suggestions travel as facts", body.facts.length >= 1);
			} else {
				check("engine answered confidently instead (acceptable)", body.outcome === "answer" && body.facts.length === 1);
			}
		});
	},
	function () {
		section("Small talk stays local and warm");
		var calls = 0;
		var convo = HKBKTalk.createConversation({ engine: new HKBKChat.Engine(kb), config: { endpoint: "https://proxy.test/talk" },
			fetchImpl: function () { calls++; return Promise.reject(new Error("must not be called for small talk")); } });
		return Promise.all([
			convo.reply("hi").then(function (r) {
				check("greeting gets a warm reply", /ask me anything/i.test(r.text), r.text);
				check("greeting is marked smalltalk", r.engine.type === "smalltalk");
			}),
			convo.reply("thanks").then(function (r) { check("thanks gets a warm reply", /welcome/i.test(r.text), r.text); }),
			convo.reply("bye").then(function (r) { check("bye gets a warm reply", /bye/i.test(r.text), r.text); }),
			convo.reply("who are you").then(function (r) { check("identity question answered", /HKBK guide/i.test(r.text), r.text); })
		]).then(function () {
			check("no model call spent on small talk", calls === 0, calls + " calls");
			return convo.reply("what is the hostel fee");
		}).then(function (r) {
			check("real questions still reach the engine", r.engine.type !== "smalltalk", r.engine.type);
		});
	}
];

(function run(i) {
	if (i >= tests.length) {
		console.log("\n== Result " + "=".repeat(52));
		console.log("  " + pass + " passed, " + fail + " failed");
		process.exit(fail ? 1 : 0);
	}
	Promise.resolve(tests[i]()).then(function () { run(i + 1); }, function (e) {
		fail++; console.log("  FAIL  harness error -> " + (e && e.message)); run(i + 1);
	});
})(0);
