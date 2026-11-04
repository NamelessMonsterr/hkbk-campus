/*
 * Node test harness for the site-control intent parser (js/talk-actions.js).
 * Run: node tests/talk-actions-test.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var ROOT = path.join(__dirname, "..");
var kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "knowledge-base.json"), "utf8"));
var actions = require(path.join(ROOT, "js", "talk-actions.js"));

var pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

var walkStops = [
	{ id: "gate", name: "Main Gate", step: 0 },
	{ id: "aiml", name: "Admin Block", step: 33 },
	{ id: "canteen", name: "Food Court", step: 45 },
	{ id: "exam", name: "Exam Section", step: 60 }
];
var places = actions.buildIndex(kb, walkStops);
var ctx = { places: places };

section("Place index");
check("index built from stops and KB", places.length > 4);
var aiml = actions._matchPlace("where is the AIML block", places);
check("AIML block resolves to its stop", aiml && aiml.stopId === "aiml", JSON.stringify(aiml));

section("Walk commands");
var a1 = actions.parse("open the walk", ctx);
check("'open the walk' starts the walk", a1 && a1.type === "start_walk");
var a2 = actions.parse("walk me through the campus", ctx);
check("'walk me through the campus' starts the walk", a2 && a2.type === "start_walk");
var a3 = actions.parse("start the walk from the food court", ctx);
check("walk from a place carries the stop", a3 && a3.type === "start_walk" && a3.stopId === "canteen", JSON.stringify(a3));

section("Show me a place");
var b1 = actions.parse("show me the admin block", ctx);
check("'show me the admin block' -> show_place aiml", b1 && b1.type === "show_place" && b1.stopId === "aiml");
var b2 = actions.parse("take me to the exam section", ctx);
check("'take me to the exam section' -> show_place exam", b2 && b2.type === "show_place" && b2.stopId === "exam");

section("Scroll the page");
var c1 = actions.parse("show me placements", ctx);
check("'show me placements' scrolls", c1 && c1.type === "scroll" && c1.anchor === "placements", JSON.stringify(c1));
var c2 = actions.parse("show me the fees", ctx);
check("'show me the fees' scrolls to admissions", c2 && c2.type === "scroll" && c2.anchor === "admissions");

section("Plain questions are not actions");
check("'what is the hostel fee' -> null", actions.parse("what is the hostel fee", ctx) === null);
check("'where is the admin block' -> null (a question, not a show command)", actions.parse("where is the admin block", ctx) === null);
check("empty -> null", actions.parse("", ctx) === null);

section("Guide commands while touring");
var g = { places: places, guiding: true };
check("'next' -> guide_next", (actions.parse("next", g) || {}).type === "guide_next");
check("'go back' -> guide_prev", (actions.parse("go back", g) || {}).type === "guide_prev");
check("'repeat' -> guide_repeat", (actions.parse("repeat", g) || {}).type === "guide_repeat");
check("'stop' -> guide_pause", (actions.parse("stop", g) || {}).type === "guide_pause");
check("'end tour' -> guide_end", (actions.parse("end tour", g) || {}).type === "guide_end");
check("'take me to the food court' -> guide_goto", (actions.parse("take me to the food court", g) || {}).type === "guide_goto");
check("a real question stays a question mid-tour", actions.parse("what is the hostel fee", g) === null);

console.log("\n== Result " + "=".repeat(52));
console.log("  " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
