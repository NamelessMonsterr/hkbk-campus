/*
 * Node test harness for the HKBK chatbot engine.
 * Run: node tests/engine-test.js
 *
 * The engine itself has no Node dependency; this file only exists to prove the
 * pipeline behaves before it is wired to any UI.
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "knowledge-base.json"), "utf8"));
var HKBKChat = require(path.join(ROOT, "js", "chatbot-engine.js"));

var pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

/* ---------- primitives ---------- */
section("Levenshtein and similarity");
var I = HKBKChat.internals;
check("identical strings distance 0", I.levenshtein("hostel", "hostel") === 0);
check("single substitution distance 1", I.levenshtein("hostel", "hostal") === 1);
check("kitten/sitting distance 3", I.levenshtein("kitten", "sitting") === 3,
	"got " + I.levenshtein("kitten", "sitting"));
var simHostal = I.similarity("hostal", "hostel");
check("hostal~hostel clears the 0.78 threshold", simHostal >= 0.78,
	"similarity " + simHostal.toFixed(3));
check("unrelated words fall below threshold", I.similarity("placement", "library") < 0.78);

section("Language identification");
check("plain English -> en", I.detectLanguage("what is the hostel fee", ["en", "kn"]) === "en");
check("Kannada script -> kn", I.detectLanguage("\u0CB9\u0CBE\u0CB8\u0CCD\u0C9F\u0CC6\u0CB2\u0CCD \u0CB6\u0CC1\u0CB2\u0CCD\u0C95", ["en", "kn"]) === "kn");
check("Devanagari -> hi", I.detectLanguage("\u092B\u0940\u0938 \u0915\u093F\u0924\u0928\u0940 \u0939\u0948", ["en", "kn", "hi"]) === "hi");

section("Chunking (512 / 64 overlap)");
var words = [];
for (var i = 0; i < 1200; i++) words.push("w" + i);
var chunks = I.chunk(words, 512, 64);
check("long input splits into multiple chunks", chunks.length > 1, "chunks " + chunks.length);
check("first chunk is exactly 512 wide", chunks[0].length === 512, "got " + chunks[0].length);
check("consecutive chunks overlap by 64",
	chunks[0][512 - 64] === chunks[1][0],
	chunks[0][512 - 64] + " vs " + chunks[1][0]);
check("short input stays one chunk", I.chunk(["a", "b"], 512, 64).length === 1);

/* ---------- engine ---------- */
section("Index build");
var engine = new HKBKChat.Engine(kb);
var stats = engine.stats();
console.log("  " + JSON.stringify(stats.counters === undefined ? stats : {
	entries: stats.entries, chunks: stats.chunks, vocabulary: stats.vocabulary, languages: stats.languages
}));
check("entries indexed", stats.entries > 25, "entries " + stats.entries);
check("chunks produced", stats.chunks >= stats.entries, "chunks " + stats.chunks);
check("vocabulary non-trivial", stats.vocabulary > 200, "vocab " + stats.vocabulary);

section("Retrieval - plain queries");
var cases = [
	["what is the hostel fee", "fees-hostel"],
	["how do i apply for admission", "admission-process"],
	["what is the cet code", "cet-code"],
	["tell me about placements", "placements"],
	["is there a metro station nearby", "metro-connectivity"],
	["is there a canteen on campus", "canteen-food"],
	["what scholarships can i get from the government", "external-scholarships"]
];
cases.forEach(function (c) {
	var r = engine.ask(c[0]);
	check('"' + c[0] + '" -> ' + c[1],
		r.type === "answer" && r.entryId === c[1],
		"got " + r.type + "/" + r.entryId + " conf=" + r.confidence);
});

section("Fuzzy recovery (the paper's ~11% rescue)");
var typo = engine.ask("wat is the hostal fes");
console.log("  answer: " + String(typo.answer).slice(0, 110) + "...");
// Calibrated refusal (2026-10): a three-typo query is no longer stated as
// fact on guessed tokens alone - it is answered, or offered back as a
// "did you mean". Either way the user must land on the hostel fee entry.
check("typo query still resolves to hostel fees",
	(typo.type === "answer" && typo.entryId === "fees-hostel") ||
	(typo.type === "clarify" && (typo.suggestions || []).some(function (s2) { return s2.entryId === "fees-hostel"; })),
	"got " + typo.type + "/" + typo.entryId);
var repairStep = (typo.trace ? typo.trace.steps : []).filter(function (s) { return s.step === "fuzzy_repair"; })[0];
check("repair step recorded in trace", !!repairStep,
	repairStep ? JSON.stringify(repairStep.repairs) : "none");
if (repairStep) console.log("  repairs: " + JSON.stringify(repairStep.repairs));

section("Token resolution");
var hostel = engine.ask("hostel fees");
check("no unresolved placeholders remain",
	hostel.unresolvedTokens.length === 0, JSON.stringify(hostel.unresolvedTokens));
check("answer contains no {{ }} markers", String(hostel.answer).indexOf("{{") === -1);
check("updated hostel figure is present",
	String(hostel.answer).indexOf("1,00,000") !== -1, hostel.answer);
console.log("  " + hostel.answer);

section("Conflict routing");
var pl = engine.ask("what is the highest package");
check("placements entry carries a conflict note", !!pl.conflict,
	"conflict=" + JSON.stringify(pl.conflict && pl.conflict.fields ? pl.conflict.fields.map(function (f) { return f.field; }) : null));
if (pl.conflict) {
	console.log("  contested fields: " + pl.conflict.fields.map(function (f) { return f.field; }).join(", "));
	console.log("  note: " + pl.conflict.text);
	check("every contested field lists more than one value",
		pl.conflict.fields.every(function (f) { return f.values.length > 1; }));
}

section("Confidence floor / out of scope");
var junk = [
	"who won the football world cup",
	"what is the price of bitcoin today",
	"can you write my python assignment for me"
];
junk.forEach(function (q) {
	var r = engine.ask(q);
	// Calibrated refusal (2026-10): junk is never stated as fact. Most is
	// refused outright; a borderline case may instead come back as a "did you
	// mean" - still never a confident wrong answer.
	check('"' + q + '" is refused or clarified, never answered',
		r.type === "out_of_scope" || r.type === "clarify",
		"got " + r.type + " entry=" + r.entryId + " conf=" + r.confidence);
});
var refusal = engine.ask("who won the football world cup");
check("refusal carries handoff contacts",
	refusal.handoff && Object.keys(refusal.handoff).length > 0);
console.log("  refusal text: " + refusal.answer);

section("Shipping configuration: English only");
var knQ = "\u0CB9\u0CBE\u0CB8\u0CCD\u0C9F\u0CC6\u0CB2\u0CCD \u0CB6\u0CC1\u0CB2\u0CCD\u0C95 \u0C8E\u0CB7\u0CCD\u0C9F\u0CC1";
check("only English is active",
	JSON.stringify(engine.languages()) === JSON.stringify(["en"]),
	"active: " + JSON.stringify(engine.languages()));
var knOnEnglishBuild = engine.ask(knQ);
check("a Kannada query is refused, not answered badly",
	knOnEnglishBuild.type === "out_of_scope",
	"got " + knOnEnglishBuild.type + " lang=" + knOnEnglishBuild.lang);

section("Multilingual capability retained, just switched off");
// Turning Kannada back on must be a data change, never a code change.
var multiKb = JSON.parse(JSON.stringify(kb));
multiKb.meta.languages = ["en", "kn"];
var multi = new HKBKChat.Engine(multiKb);
var kn = multi.ask(knQ);
check("re-enabling Kannada answers in Kannada", kn.type === "answer" && kn.lang === "kn",
	"got " + kn.type + " lang=" + kn.lang + " entry=" + kn.entryId);
check("Kannada answer is in Kannada script", /[\u0C80-\u0CFF]/.test(kn.answer || ""));
check("Kannada answer carries no English figure",
	!/(lakh|LPA|approximately)/.test(kn.answer || ""), String(kn.answer).slice(0, 160));
if (kn.answer) console.log("  " + String(kn.answer).slice(0, 120));

section("Hindi under an English-only build");
var hiQ = "\u0932\u093E\u0907\u092C\u094D\u0930\u0947\u0930\u0940 \u0915\u0947 \u092C\u093E\u0930\u0947 \u092E\u0947\u0902 \u092C\u0924\u093E\u0913";
var hi = engine.ask(hiQ);
check("Hindi query returns something usable",
	hi.type === "answer" || hi.type === "out_of_scope",
	"got " + hi.type);
if (hi.type === "answer") {
	console.log("  served in: " + hi.lang + " (fell back: " + hi.languageFellBack + ")");
}

section("Answers point at a page section");
var declared = Object.keys(kb.meta.sections || {});
check("page sections are declared in the data file", declared.length >= 8,
	"declared: " + declared.length);
var untagged = kb.entries.filter(function (e) { return !e.section; }).map(function (e) { return e.id; });
check("every entry names a section", untagged.length === 0, "untagged: " + untagged.join(", "));
var bogus = kb.entries.filter(function (e) { return declared.indexOf(e.section) === -1; })
	.map(function (e) { return e.id + "->" + e.section; });
check("no entry points at an undeclared section", bogus.length === 0, bogus.join(", "));
var navHostel = engine.ask("what is the hostel fee");
check("hostel answer routes to the hostel section", navHostel.section === "hostel",
	"got " + navHostel.section);
var navPlace = engine.ask("tell me about placements");
check("placement answer routes to the placements section", navPlace.section === "placements",
	"got " + navPlace.section);
console.log("  sections: " + declared.join(", "));

section("Memory buffer");
engine.endSession();
for (var m = 0; m < 14; m++) engine.ask("hostel fees");
check("buffer capped at 10 turns", engine.memory.turns.length === 10,
	"depth " + engine.memory.turns.length);
engine.endSession();
check("session end clears the buffer", engine.memory.turns.length === 0);

section("Follow-up resolution via memory");
engine.endSession();
var first = engine.ask("tell me about the hostel");
var follow = engine.ask("what about the fee for it");
console.log("  first -> " + first.entryId + ", follow-up -> " + follow.entryId);
// Calibrated refusal (2026-10): the follow-up may come back as a "did you
// mean" when two hostel entries tie, as long as the options stay on topic.
check("follow-up stays on a hostel-related entry",
	(follow.type === "answer" && /hostel/.test(follow.entryId || "")) ||
	(follow.type === "clarify" && (follow.suggestions || []).some(function (s2) { return /hostel/.test(s2.entryId); })),
	"got " + follow.type + "/" + follow.entryId);

section("LLM hook is absent by default");
check("engine answers with no LLM configured", engine.llmHook === null);
check("hook is settable", (function () {
	engine.setLlmHook(function () { return "x"; });
	var ok = typeof engine.llmHook === "function";
	engine.setLlmHook(null);
	return ok;
}()));

section("Result");
console.log("  " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
