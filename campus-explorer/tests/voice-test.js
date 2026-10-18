/* voice-test.js - unit checks for the voice guide module (no browser APIs). */
"use strict";
var path = require("path");
var V = require(path.join(__dirname, "..", "js", "voice-guide.js"));

var passed = 0, failed = 0;
function ok(cond, name) {
	if (cond) { passed++; }
	else { failed++; console.error("FAIL: " + name); }
}

/* languages */
ok(V.LANGS.length === 4, "four languages offered");
var codes = V.LANGS.map(function (l) { return l.code; }).sort().join(",");
ok(codes === "en,hi,kn,ur", "languages are en, kn, hi, ur");
ok(V.LANGS.every(function (l) { return /^[a-z]{2}-[A-Z]{2}$/.test(l.speech); }), "every language has a BCP-47 speech code");

/* script completeness */
Object.keys(V.SCRIPT).forEach(function (k) {
	ok(V.SCRIPT[k].length >= 5, k + " script has at least 5 segments");
	ok(V.SCRIPT[k].every(function (s) { return typeof s === "string" && s.length > 40; }), k + " segments non-trivial");
});
ok(Object.keys(V.SCRIPT).sort().join(",") === "en,hi,kn,ur", "script covers all four languages");

/* verified facts appear in the English script */
var en = V.SCRIPT.en.join(" ");
["1997", "Manyata Tech Park", "KCET", "COMEDK", "management quota", "375", "94.3", "32.4", "fourteen"].forEach(function (f) {
	ok(en.indexOf(f) !== -1, "en script keeps verified fact: " + f);
});
["1997", "KCET", "COMEDK", "375", "94.3", "32.4"].forEach(function (f) {
	ok(V.SCRIPT.kn.join(" ").indexOf(f) !== -1, "kn script keeps fact: " + f);
	ok(V.SCRIPT.hi.join(" ").indexOf(f) !== -1, "hi script keeps fact: " + f);
	ok(V.SCRIPT.ur.join(" ").indexOf(f) !== -1, "ur script keeps fact: " + f);
});

/* missing-voice notices exist per language */
["en", "kn", "hi", "ur"].forEach(function (k) {
	ok(typeof V.NO_VOICE_NOTICE[k] === "string" && V.NO_VOICE_NOTICE[k].length > 10, "no-voice notice for " + k);
});

/* pickVoice: exact, prefix, miss */
var voices = [{ lang: "en-US" }, { lang: "kn-IN" }, { lang: "hi_IN" }];
ok(V.pickVoice(voices, "kn-IN").lang === "kn-IN", "exact match wins");
ok(V.pickVoice(voices, "hi-IN").lang === "hi_IN", "underscore variant matches");
ok(V.pickVoice(voices, "ur-PK") === null, "no urdu voice returns null (fallback path)");
ok(V.pickVoice([{ lang: "en-GB" }], "en-IN").lang === "en-GB", "prefix match for en");
ok(V.pickVoice([], "en-IN") === null, "empty voice list returns null");
ok(V.pickVoice(null, "en-IN") === null, "null voice list returns null");

/* speak() without browser APIs resolves false and still fires callbacks */
var ended = false, missed = false;
var r = V.speak("hello", "en", { onend: function () { ended = true; }, onmissing: function () { missed = true; } });
ok(r === false, "speak returns false without speechSynthesis");
ok(ended === true, "onend fires even when unsupported");
ok(missed === true, "onmissing fires when unsupported");

/* research-driven normalisation: Android underscores, Firefox-Android 3-letter codes */
ok(V.pickVoice([{ lang: "hi_in" }], "hi-IN").lang === "hi_in", "Android underscore voice matches");
ok(V.pickVoice([{ lang: "kan-IN" }], "kn-IN").lang === "kan-IN", "3-letter kan matches kn");
ok(V.pickVoice([{ lang: "urd-PK" }], "ur-PK").lang === "urd-PK", "3-letter urd matches ur");
ok(V.pickVoice([{ lang: "eng-US-f000" }], "en-IN").lang === "eng-US-f000", "Firefox-Android eng-US-f000 matches en");

/* typing is first-class, voice controls exist, permission fallback exists (source-level) */
var fs = require("fs");
var ui = fs.readFileSync(path.join(__dirname, "..", "js", "chatbot-ui.js"), "utf8");
ok(ui.indexOf("chat__input") !== -1, "typed input present");
ok(ui.indexOf("chat__speak") !== -1, "Speak toggle present");
ok(ui.indexOf("Hands-free") !== -1, "hands-free toggle present");
ok(ui.indexOf("not-allowed") !== -1, "mic-permission-denied path present");
ok(ui.indexOf("typing works the same") !== -1, "no-recognition typed fallback copy present");
ok(ui.indexOf("chat__bigmic") !== -1, "voice-first big mic present");
ok(ui.indexOf("HKBKVoice.speak") !== -1, "spoken answers wired");

console.log("voice-test: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
