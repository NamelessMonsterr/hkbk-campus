/*
 * Node tests for the TalkUI <-> Gemini Live glue in js/talk-ui.js.
 * Run: node tests/talk-ui-live-test.js
 * No DOM: TalkUI instances are built with Object.create and the few fields
 * each path touches are stubbed, so the privacy/mic-lifecycle logic itself
 * is what is under test.
 */
"use strict";
var path = require("path");
require(path.join(__dirname, "..", "js", "talk-ui.js"));
var TalkUI = globalThis.HKBKTalkUI.TalkUI;

var pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

section("Privacy stop when the page hides (_stopForHidden)");
function freshUi(state) {
	var ui = Object.create(TalkUI.prototype);
	ui.state = state;
	ui._session = 7;
	ui.events = {};
	ui.live = { stop: function () { ui.events.liveStopped = true; } };
	ui._stopRec = function () { ui.events.recStopped = true; };
	ui._setState = function (s, t) { ui.state = s; ui.events.status = t; };
	ui._note = function (t) { ui.events.note = t; };
	ui.modeDot = { textContent: "" };
	return ui;
}
globalThis.HKBKVoice = { cancel: function () { globalThis.__cancelled = true; } };

var ui = freshUi("listening");
ui._stopForHidden();
check("live session stopped and dropped", ui.events.liveStopped === true && ui.live === null);
check("classic recognition + TTS cancelled", ui.events.recStopped === true && globalThis.__cancelled === true);
check("session bumped so in-flight callbacks and retries are dead", ui._session === 8);
check("badge + status say the mic is off and nothing restarts on its own",
	ui.modeDot.textContent === "mic off" && /reopen Assistant mode/.test(ui.events.status) && /Audio streaming stopped/.test(ui.events.note));

var closedUi = freshUi("closed");
closedUi._stopForHidden();
check("already closed -> no-op (nothing stopped twice)", closedUi.events.liveStopped === undefined && closedUi.state === "closed");

section("Live start errors map to honest copy (_openLive)");
globalThis.HKBK_TALK_CONFIG = { endpoint: "https://talk.example" };
function openWith(err) {
	return new Promise(function (resolve) {
		var calls = [];
		globalThis.HKBKGeminiLive = {
			LiveSession: function () {
				this.start = function () { calls.push("start"); return Promise.reject(err); };
				this.stop = function () {};
			}
		};
		var u = Object.create(TalkUI.prototype);
		u.state = "idle";
		u._session = 1;
		u._setState = function (s, t) { calls.push("state:" + s); };
		u._note = function (t) { calls.push("note:" + t.slice(0, 60)); u.__privacyNote = t; };
		u._liveFallback = function (greet, why) { resolve({ why: why, calls: calls, privacy: u.__privacyNote }); };
		u._openLive("hi");
	});
}

Promise.resolve()
	.then(function () { return openWith({ message: "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission", name: "NotAllowedError" }); })
	.then(function (r) {
		check("Firefox-style NotAllowedError -> mic-denied copy", /^Microphone permission was denied/.test(r.why), r.why);
		return openWith({ message: "Permission denied", name: "NotAllowedError" });
	})
	.then(function (r) {
		check("Chrome-style denial -> mic-denied copy", /^Microphone permission was denied/.test(r.why), r.why);
		return openWith(new Error("token_429"));
	})
	.then(function (r) {
		check("token 429 -> busy/quota copy", /busy or its quota/.test(r.why), r.why);
		return openWith(new Error("ws_closed_1006"));
	})
	.then(function (r) {
		check("generic failure -> plain could-not-start copy", r.why === "Live voice could not start", r.why);
		var noteAt = r.calls.findIndex(function (c) { return c.indexOf("note:") === 0; });
		check("privacy disclosure is set before the mic is asked for",
			noteAt >= 0 && noteAt < r.calls.indexOf("start") &&
			/improve its products/.test(r.privacy) && /Close this panel to stop the mic/.test(r.privacy), r.calls.join(" | "));
		console.log("\n  " + pass + " passed, " + fail + " failed");
		process.exit(fail ? 1 : 0);
	});
