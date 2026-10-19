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


/* --- pre-generated tour audio (2026-10) --- */
ok(V.AUDIO && typeof V.AUDIO === "object", "AUDIO map exported");
ok(Object.keys(V.AUDIO).sort().join(",") === "en,hi", "pre-generated audio only for en and hi (kn/ur stay text-only)");
["en", "hi"].forEach(function (k) {
	ok(V.AUDIO[k].length === V.SCRIPT[k].length, k + " has one audio file per script segment");
	ok(V.AUDIO[k].every(function (u, i) { return u === "assets/audio/tour-" + k + "-" + (i + 1) + ".mp3"; }), k + " audio paths follow tour-<lang>-<n>.mp3");
});
ok(!V.AUDIO.kn && !V.AUDIO.ur, "no kn/ur audio files (scripts await native review)");

/* speak() with an audioUrl but no Audio constructor (node) falls through to the TTS path */
var ae = false;
var r2 = V.speak("hello", "en", { audioUrl: "assets/audio/tour-en-1.mp3", onend: function () { ae = true; } });
ok(r2 === false, "no Audio constructor: audio branch skipped, TTS path resolves false in node");
ok(ae === true, "onend still fires on the fallback path");

/* speak() with a working Audio mock: plays the file, never touches TTS, cancel() pauses */
var made = [];
globalThis.Audio = function () {
	var self = { src: null, paused: false, played: false };
	self.play = function () { self.played = true; return { catch: function () {} }; };
	self.pause = function () { self.paused = true; };
	made.push(self);
	return self;
};
var endCount = 0;
var r3 = V.speak("hello", "en", { audioUrl: "assets/audio/tour-en-1.mp3", onend: function () { endCount++; } });
ok(r3 === true, "audio branch returns true when Audio exists");
ok(made.length === 1 && made[0].src === "assets/audio/tour-en-1.mp3", "Audio element pointed at the given file");
ok(made[0].played === true, "play() called");
made[0].onended();
ok(endCount === 1, "onend fires once when the file ends");

/* cancel() pauses a playing file */
V.speak("again", "hi", { audioUrl: "assets/audio/tour-hi-2.mp3", onend: function () {} });
ok(made.length === 2 && made[1].src === "assets/audio/tour-hi-2.mp3", "second file queued");
V.cancel();
ok(made[1].paused === true, "cancel() pauses the playing file");

/* error and rejected-play both fall back to browser speech (never lose the line) */
globalThis.Audio = function () {
	var self = { src: null };
	self.play = function () { return { catch: function (fn) { fn(); } }; };
	self.pause = function () {};
	made.push(self);
	return self;
};
var fbEnd = false;
V.speak("fallback test", "en", { audioUrl: "x.mp3", onend: function () { fbEnd = true; } });
ok(fbEnd === true, "rejected play() falls back to TTS path (onend fires via unsupported-TTS in node)");
var errEnd = false;
globalThis.Audio = function () {
	var self = { src: null };
	self.play = function () { return { catch: function () {} }; };
	self.pause = function () {};
	made.push(self);
	setTimeout(function () {}, 0);
	return self;
};
V.speak("err test", "en", { audioUrl: "missing.mp3", onend: function () { errEnd = true; } });
made[made.length - 1].onerror();
ok(errEnd === true, "audio error event falls back to TTS path");
delete globalThis.Audio;

/* the tour player passes per-segment audio for en/hi and null for kn/ur */
var fs2 = require("fs");
var landing = fs2.readFileSync(require("path").join(__dirname, "..", "..", "index.html"), "utf8");
ok(landing.indexOf("V.AUDIO[lang][idx]") !== -1, "tour player looks up per-segment audio");
ok(landing.indexOf("audioUrl:url") !== -1, "tour player passes audioUrl into speak()");


/* --- NOTICE_AUDIO: English "no voice" notices as files ----------------- */
ok(V.NOTICE_AUDIO && typeof V.NOTICE_AUDIO === "object", "NOTICE_AUDIO map exported");
ok(Object.keys(V.NOTICE_AUDIO).sort().join(",") === "en,hi,kn,ur", "one notice file per language (all spoken in English)");
ok(V.NOTICE_AUDIO.en === "assets/audio/notice-en-1.mp3" &&
	V.NOTICE_AUDIO.kn === "assets/audio/notice-en-2.mp3" &&
	V.NOTICE_AUDIO.hi === "assets/audio/notice-en-3.mp3" &&
	V.NOTICE_AUDIO.ur === "assets/audio/notice-en-4.mp3", "notice paths follow notice-en-<n>.mp3 in NO_VOICE_NOTICE key order");

/* every wired audio file exists on disk (tour en/hi + notices) */
var allAudio = V.AUDIO.en.concat(V.AUDIO.hi, Object.keys(V.NOTICE_AUDIO).map(function (k) { return V.NOTICE_AUDIO[k]; }));
ok(allAudio.length === 16, "16 audio files wired (6 en tour + 6 hi tour + 4 notices)");
ok(allAudio.every(function (u) { return fs2.existsSync(require("path").join(__dirname, "..", "..", u)); }), "every wired audio file exists on disk");

/* missing language voice: notice plays as a file, then the line via TTS */
var spoken = [];
globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
globalThis.speechSynthesis = {
	getVoices: function () { return []; },
	speak: function (u) { spoken.push(u); if (u.onend) u.onend(); },
	cancel: function () {}
};
var madeN = [];
globalThis.Audio = function () {
	var self = { src: null, paused: false };
	self.play = function () { return { catch: function () {} }; };
	self.pause = function () { self.paused = true; };
	madeN.push(self);
	return self;
};
var missedCode = null;
var r4 = V.speak("yeh line hai", "hi", { onmissing: function (c) { missedCode = c; } });
ok(r4 === true, "missing Hindi voice: notice file path returns true");
ok(missedCode === "hi", "onmissing fires with the requested language");
ok(madeN.length === 1 && madeN[0].src === "assets/audio/notice-en-3.mp3", "Hindi notice file played first");
ok(spoken.length === 0, "line not spoken before the notice finishes");
madeN[0].onended();
ok(spoken.length === 1 && spoken[0].text === "yeh line hai", "after the notice, the line itself is spoken unprefixed");

/* notice file error: notice + line read together in one utterance */
spoken = [];
V.speak("doosri line", "kn", {});
madeN[madeN.length - 1].onerror();
ok(spoken.length === 1 && spoken[0].text.indexOf("no Kannada voice") !== -1 && spoken[0].text.indexOf("doosri line") !== -1,
	"notice file failure reads notice + line in one utterance");

/* a custom missingNotice has no file: straight to the combined utterance */
spoken = [];
var beforeN = madeN.length;
V.speak("custom", "ur", { missingNotice: "Custom notice." });
ok(madeN.length === beforeN, "custom missingNotice: no audio file played");
ok(spoken.length === 1 && spoken[0].text === "Custom notice. custom", "custom missingNotice spoken with the line");

/* English requests never take the notice path */
spoken = [];
beforeN = madeN.length;
V.speak("plain english", "en", {});
ok(madeN.length === beforeN && spoken.length === 1 && spoken[0].text === "plain english", "en with no voices: no notice, just the line");

delete globalThis.Audio;
delete globalThis.speechSynthesis;
delete globalThis.SpeechSynthesisUtterance;


console.log("voice-test: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);