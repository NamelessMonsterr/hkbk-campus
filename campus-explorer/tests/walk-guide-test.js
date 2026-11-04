/*
 * Node test harness for the guided walk narration (walk/walk-guide.js).
 * Run: node tests/walk-guide-test.js
 *
 * DOM and speech are stubbed; what is proven: the narration carries the KB's
 * verified facts, commands drive the walk control hook, questions go to the
 * conversation layer, and the tour ends cleanly.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var ROOT = path.join(__dirname, "..");
var kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "knowledge-base.json"), "utf8"));

/* walk-guide.js expects a browser-ish global; give it one. */
global.window = global;
global.WALK = { stops: [
	{ id: "gate", n: 1, name: "Main Gate", desc: "Walk in through the main gate.", step: 0 },
	{ id: "canteen", n: 9, name: "Food Court", desc: "The canteen area.", step: 45 },
	{ id: "exam", n: 14, name: "Exam Section", desc: "The exam office.", step: 64 }
]};
var spoken = [];
global.HKBKVoice = { speak: function (t, lang, opts) { spoken.push(t); if (opts && opts.onend) opts.onend(); }, cancel: function () {} };
require(path.join(ROOT, "js", "chatbot-engine.js"));
require(path.join(ROOT, "js", "talk-config.js"));
require(path.join(ROOT, "js", "conversation.js"));
require(path.join(ROOT, "js", "talk-actions.js"));
var WG = require(path.join(ROOT, "..", "walk", "walk-guide.js"));

var pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

/* Fake walk control: tracks where the walk was driven. */
function fakeCtl() {
	var state = { at: "gate", moves: [] };
	return {
		moves: state.moves,
		chapter: function () { return state.at; },  // matches the page's __walkCtl contract
		next: function () { state.moves.push("next"); },
		prev: function () { state.moves.push("prev"); },
		gotoStop: function (id) { state.moves.push("goto:" + id); state.at = id; }
	};
}
function mkGuide(ctl) {
	var g = new WG.WalkGuide({ ctl: ctl, kb: kb });
	/* skip DOM panel: the logic under test never touches it when we drive _hear */
	g.panel = { classList: { add: function () {}, remove: function () {} } };
	g.mic = { classList: { add: function () {}, remove: function () {} } };
	g.statusEl = { textContent: "" };
	g.captionEl = { textContent: "" };
	g.active = true;
	g._listen = function () {};   // no speech recognition in Node
	return g;
}

section("Narration content");
var gate = { id: "gate", name: "Main Gate", desc: "Walk in through the main gate." };
var entry = kb.entries.find(function (e) { return e.id === "loc-main-gate"; });
var n = WG.buildNarration(gate, entry);
check("narration names the stop", n.indexOf("Main Gate.") === 0);
check("narration uses the KB's verified fact", n.indexOf("opposite Manyata Tech Park") !== -1);
var bare = WG.buildNarration({ id: "x", name: "X", desc: "Just a spot." }, null);
check("no KB entry -> walk's own description", bare === "X. Just a spot.");
check("null stop -> empty", WG.buildNarration(null, null) === "");

section("Commands drive the walk");
spoken = [];
var ctl = fakeCtl();
var g = mkGuide(ctl);
g._narrateCurrent(false);
check("first narration speaks the current stop", spoken[0].indexOf("Main Gate.") === 0);
g._hear("next");
check("'next' jumps to the next named stop", ctl.moves.indexOf("goto:canteen") !== -1, JSON.stringify(ctl.moves));
check("new stop narrated", spoken.some(function (t) { return t.indexOf("Food Court.") === 0; }));
g._hear("back");
check("'back' returns to the previous stop", spoken[spoken.length-1].indexOf("Main Gate.") === 0, spoken[spoken.length-1].slice(0,40));
g._hear("back");
check("'back' at the first stop says so", /first stop/.test(spoken[spoken.length-1]), spoken[spoken.length-1].slice(0,60));
g._hear("repeat");
check("'repeat' re-speaks the last narration", spoken[spoken.length - 1] === g.lastNarration);
g._hear("take me to the exam section");
check("'take me to X' jumps the walk", ctl.moves.indexOf("goto:exam") !== -1);
check("jump narrates the exam section", spoken.some(function (t) { return t.indexOf("Exam Section.") === 0; }));

section("Pause and end");
var ctl2 = fakeCtl();
var g2 = mkGuide(ctl2);
g2._hear("stop");
check("'stop' pauses the tour", g2.paused === true);
g2._hear("end tour");
check("'end tour' deactivates the guide", g2.active === false);

section("Questions still answered mid-tour");
spoken = [];
g._hear("what is the hostel fee");
/* conversation.reply is async even offline - let the microtask run */
setTimeout(function () {
	check("question answered from the KB", spoken.some(function (t) { return /hostel/i.test(t) && t.length > 30; }),
		JSON.stringify(spoken).slice(0, 120));

	console.log("\n== Result " + "=".repeat(52));
	console.log("  " + pass + " passed, " + fail + " failed");
	process.exit(fail ? 1 : 0);
}, 10);
