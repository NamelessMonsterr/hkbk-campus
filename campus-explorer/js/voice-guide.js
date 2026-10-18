/*
 * voice-guide.js - spoken guided tour + shared speech helpers.
 * Uses only the browser's built-in speech synthesis / recognition. No keys,
 * no network services. All facts below come from the verified knowledge
 * base and the site's published figures.
 */
(function (global) {
	"use strict";

	var LANGS = [
		{ code: "en", label: "English", speech: "en-IN" },
		{ code: "kn", label: "\u0C95\u0CA8\u0CCD\u0CA8\u0CA1", speech: "kn-IN" },
		{ code: "hi", label: "\u0939\u093F\u0928\u094D\u0926\u0940", speech: "hi-IN" },
		{ code: "ur", label: "\u0627\u0631\u062F\u0648", speech: "ur-PK" }
	];

	var SCRIPT = {
		en: [
			"Welcome to HKBK Group of Institutions: seventeen acres opposite Manyata Tech Park in Bengaluru, teaching engineering, management, degree and pre-university courses since 1997.",
			"Admissions run through three routes: KCET, COMEDK, or the management quota. The admissions guide on this site walks you through eligibility, documents and each step.",
			"Six departments are listed in the department explorer, from Computer Science, started in 1997, to the newest Artificial Intelligence and Machine Learning branch, plus the MBA.",
			"As published by the college, placements reach 94.3 percent, with more than 375 recruiters, and a highest package of 32.4 lakh per annum in 2023.",
			"The campus map pins all fourteen stops, and the campus walk takes you through them one by one.",
			"Any time you have a question, tap Ask HKBK and type or speak. The assistant answers only from its verified knowledge base, and says so when it does not know."
		],
		kn: [
			"HKBK Group of Institutions \u0C97\u0CC6 \u0CB8\u0CC1\u0CB8\u0CCD\u0CB5\u0CBE\u0C97\u0CA4. Bengaluru \u0CA8\u0CB2\u0CCD\u0CB2\u0CBF Manyata Tech Park \u0C8E\u0CA6\u0CC1\u0CB0\u0CBF\u0C97\u0CC6 \u0CB9\u0CA6\u0CBF\u0CA8\u0CC7\u0CB3\u0CC1 \u0C8E\u0C95\u0CB0\u0CC6 \u0C95\u0CCD\u0CAF\u0CBE\u0C82\u0CAA\u0CB8\u0CCD. 1997 \u0CB0\u0CBF\u0C82\u0CA6 \u0C87\u0C82\u0C9C\u0CBF\u0CA8\u0CBF\u0CAF\u0CB0\u0CBF\u0C82\u0C97\u0CCD, \u0CAE\u0CCD\u0CAF\u0CBE\u0CA8\u0CC7\u0C9C\u0CCD\u0CAE\u0CC6\u0C82\u0C9F\u0CCD, \u0CA1\u0CBF\u0C97\u0CCD\u0CB0\u0CBF \u0CAE\u0CA4\u0CCD\u0CA4\u0CC1 pre-university \u0C95\u0CCB\u0CB0\u0CCD\u0CB8\u0CCD\u200C\u0C97\u0CB3\u0CC1 \u0C87\u0CB2\u0CCD\u0CB2\u0CBF \u0CA8\u0CA1\u0CC6\u0CAF\u0CC1\u0CA4\u0CCD\u0CA4\u0CB5\u0CC6.",
			"Admission \u0CAE\u0CC2\u0CB0\u0CC1 \u0CA6\u0CBE\u0CB0\u0CBF\u0C97\u0CB3\u0CBF\u0C82\u0CA6: KCET, COMEDK, \u0C85\u0CA5\u0CB5\u0CBE management quota. \u0C88 site \u0CA8 admissions guide \u0CA8\u0CB2\u0CCD\u0CB2\u0CBF eligibility, documents \u0CAE\u0CA4\u0CCD\u0CA4\u0CC1 \u0CAA\u0CCD\u0CB0\u0CA4\u0CBF \u0CB9\u0C82\u0CA4\u0CA6 \u0CAE\u0CBE\u0CB9\u0CBF\u0CA4\u0CBF \u0C87\u0CA6\u0CC6.",
			"Department explorer \u0CA8\u0CB2\u0CCD\u0CB2\u0CBF \u0C86\u0CB0\u0CC1 departments \u0C87\u0CB5\u0CC6: 1997 \u0CB0\u0CB2\u0CCD\u0CB2\u0CBF \u0CB6\u0CC1\u0CB0\u0CC1\u0CB5\u0CBE\u0CA6 Computer Science \u0C87\u0C82\u0CA6 \u0CB9\u0CCA\u0CB8 Artificial Intelligence and Machine Learning branch \u0CB5\u0CB0\u0CC6\u0C97\u0CC6, \u0C9C\u0CCA\u0CA4\u0CC6\u0C97\u0CC6 MBA.",
			"College \u0CAA\u0CCD\u0CB0\u0C95\u0C9F\u0CBF\u0CB8\u0CBF\u0CA6 \u0C85\u0C82\u0C95\u0CBF\u0C85\u0C82\u0CB6\u0C97\u0CB3 \u0CAA\u0CCD\u0CB0\u0C95\u0CBE\u0CB0, placements 94.3 percent, 375 \u0C95\u0CCD\u0C95\u0CC2 \u0CB9\u0CC6\u0C9A\u0CCD\u0C9A\u0CC1 recruiters, \u0CAE\u0CA4\u0CCD\u0CA4\u0CC1 2023 \u0CB0\u0CB2\u0CCD\u0CB2\u0CBF highest package 32.4 lakh per annum.",
			"Campus map \u0CA8\u0CB2\u0CCD\u0CB2\u0CBF \u0CB9\u0CA6\u0CBF\u0CA8\u0CBE\u0CB2\u0CCD\u0C95\u0CC1 stops \u0C97\u0CB3\u0CA8\u0CCD\u0CA8\u0CC1 \u0C97\u0CC1\u0CB0\u0CC1\u0CA4\u0CBF\u0CB8\u0CB2\u0CBE\u0C97\u0CBF\u0CA6\u0CC6. Campus walk \u0CA8\u0CBF\u0CAE\u0CCD\u0CAE\u0CA8\u0CCD\u0CA8\u0CC1 \u0CAA\u0CCD\u0CB0\u0CA4\u0CBF stop \u0C97\u0CC6 \u0C95\u0CB0\u0CC6\u0CA6\u0CCA\u0CAF\u0CCD\u0CAF\u0CC1\u0CA4\u0CCD\u0CA4\u0CA6\u0CC6.",
			"\u0CAF\u0CBE\u0CB5\u0CC1\u0CA6\u0CBE\u0CA6\u0CB0\u0CC2 \u0CAA\u0CCD\u0CB0\u0CB6\u0CCD\u0CA8\u0CC6 \u0C87\u0CA6\u0CCD\u0CA6\u0CB0\u0CC6, Ask HKBK \u0C85\u0CA8\u0CCD\u0CA8\u0CC1 \u0C92\u0CA4\u0CCD\u0CA4\u0CBF type \u0CAE\u0CBE\u0CA1\u0CBF \u0C85\u0CA5\u0CB5\u0CBE \u0CAE\u0CBE\u0CA4\u0CA8\u0CBE\u0CA1\u0CBF. Assistant \u0CA4\u0CA8\u0CCD\u0CA8 verified knowledge base \u0CA8\u0CBF\u0C82\u0CA6 \u0CAE\u0CBE\u0CA4\u0CCD\u0CB0 \u0C89\u0CA4\u0CCD\u0CA4\u0CB0\u0CBF\u0CB8\u0CC1\u0CA4\u0CCD\u0CA4\u0CA6\u0CC6; \u0CA4\u0CBF\u0CB3\u0CBF\u0CA6\u0CBF\u0CB2\u0CCD\u0CB2\u0CA6\u0CBF\u0CA6\u0CCD\u0CA6\u0CB0\u0CC6 \u0C85\u0CA6\u0CA8\u0CCD\u0CA8\u0CC1 \u0CB9\u0CC7\u0CB3\u0CC1\u0CA4\u0CCD\u0CA4\u0CA6\u0CC6."
		],
		hi: [
			"HKBK Group of Institutions \u092E\u0947\u0902 \u0906\u092A\u0915\u093E \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948\u0964 Bengaluru \u092E\u0947\u0902 Manyata Tech Park \u0915\u0947 \u0938\u093E\u092E\u0928\u0947 \u0938\u0924\u094D\u0930\u0939 \u090F\u0915\u0921\u093C \u0915\u093E campus, \u091C\u0939\u093E\u0901 1997 \u0938\u0947 engineering, management, degree \u0914\u0930 pre-university courses \u091A\u0932\u0924\u0947 \u0939\u0948\u0902\u0964",
			"Admission \u0915\u0947 \u0924\u0940\u0928 \u0930\u093E\u0938\u094D\u0924\u0947 \u0939\u0948\u0902: KCET, COMEDK \u092F\u093E management quota. \u0907\u0938 site \u0915\u0940 admissions guide \u092E\u0947\u0902 eligibility, documents \u0914\u0930 \u0939\u0930 step \u0915\u0940 \u091C\u093E\u0928\u0915\u093E\u0930\u0940 \u0939\u0948\u0964",
			"Department explorer \u092E\u0947\u0902 \u091B\u0939 departments \u0939\u0948\u0902: 1997 \u092E\u0947\u0902 \u0936\u0941\u0930\u0942 \u0939\u0941\u0906 Computer Science \u0938\u0947 \u0932\u0947\u0915\u0930 \u0928\u092F\u093E Artificial Intelligence and Machine Learning branch, \u0914\u0930 MBA.",
			"College \u0915\u0947 \u092A\u094D\u0930\u0915\u093E\u0936\u093F\u0924 \u0906\u0901\u0915\u0921\u093C\u094B\u0902 \u0915\u0947 \u0905\u0928\u0941\u0938\u093E\u0930 placements 94.3 percent \u0939\u0948\u0902, 375 \u0938\u0947 \u091C\u093C\u094D\u092F\u093E\u0926\u093E recruiters \u0906\u0924\u0947 \u0939\u0948\u0902, \u0914\u0930 2023 \u092E\u0947\u0902 highest package 32.4 lakh \u0938\u093E\u0932\u093E\u0928\u093E \u0925\u093E\u0964",
			"Campus map \u092E\u0947\u0902 \u0938\u092D\u0940 \u091A\u094C\u0926\u0939 stops \u0926\u093F\u0916\u093E\u090F \u0917\u090F \u0939\u0948\u0902, \u0914\u0930 campus walk \u0906\u092A\u0915\u094B \u090F\u0915 \u090F\u0915 stop \u0926\u093F\u0916\u093E\u0924\u0940 \u0939\u0948\u0964",
			"\u0915\u094B\u0908 \u092D\u0940 \u0938\u0935\u093E\u0932 \u0939\u094B \u0924\u094B Ask HKBK \u092A\u0930 tap \u0915\u0930\u0915\u0947 type \u092F\u093E \u092C\u094B\u0932\u0915\u0930 \u092A\u0942\u091B\u0947\u0902\u0964 Assistant \u0938\u093F\u0930\u094D\u092B \u0905\u092A\u0928\u0947 verified knowledge base \u0938\u0947 \u091C\u0935\u093E\u092C \u0926\u0947\u0924\u093E \u0939\u0948, \u0914\u0930 \u091C\u094B \u0928\u0939\u0940\u0902 \u091C\u093E\u0928\u0924\u093E \u0935\u094B \u0938\u093E\u092B \u0915\u0939 \u0926\u0947\u0924\u093E \u0939\u0948\u0964"
		],
		ur: [
			"HKBK Group of Institutions \u0645\u06CC\u06BA \u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u062F\u06D4 Bengaluru \u0645\u06CC\u06BA Manyata Tech Park \u06A9\u06D2 \u0633\u0627\u0645\u0646\u06D2 \u0633\u062A\u0631\u06C1 \u0627\u06CC\u06A9\u0691 \u06A9\u0627 campus\u060C \u062C\u06C1\u0627\u06BA 1997 \u0633\u06D2 engineering\u060C management\u060C degree \u0627\u0648\u0631 pre-university courses \u06C1\u0648\u062A\u06D2 \u06C1\u06CC\u06BA\u06D4",
			"Admission \u06A9\u06D2 \u062A\u06CC\u0646 \u0631\u0627\u0633\u062A\u06D2 \u06C1\u06CC\u06BA: KCET\u060C COMEDK \u06CC\u0627 management quota\u06D4 \u0627\u0633 site \u06A9\u06CC admissions guide \u0645\u06CC\u06BA eligibility\u060C documents \u0627\u0648\u0631 \u06C1\u0631 step \u06A9\u06CC \u062A\u0641\u0635\u06CC\u0644 \u06C1\u06D2\u06D4",
			"Department explorer \u0645\u06CC\u06BA \u0686\u06BE departments \u06C1\u06CC\u06BA: 1997 \u0645\u06CC\u06BA \u0634\u0631\u0648\u0639 \u06C1\u0648\u0627 Computer Science \u0633\u06D2 \u0644\u06D2 \u06A9\u0631 \u0646\u06CC\u0627 Artificial Intelligence and Machine Learning branch\u060C \u0627\u0648\u0631 MBA\u06D4",
			"College \u06A9\u06D2 \u0634\u0627\u0626\u0639 \u06A9\u0631\u062F\u06C1 \u0627\u0639\u062F\u0627\u062F \u06A9\u06D2 \u0645\u0637\u0627\u0628\u0642 placements 94.3 percent \u06C1\u06CC\u06BA\u060C 375 \u0633\u06D2 \u0632\u06CC\u0627\u062F\u06C1 recruiters \u0622\u062A\u06D2 \u06C1\u06CC\u06BA\u060C \u0627\u0648\u0631 2023 \u0645\u06CC\u06BA highest package 32.4 lakh \u0633\u0627\u0644\u0627\u0646\u06C1 \u062A\u06BE\u0627\u06D4",
			"Campus map \u0645\u06CC\u06BA \u062A\u0645\u0627\u0645 \u0686\u0648\u062F\u06C1 stops \u062F\u06A9\u06BE\u0627\u0626\u06D2 \u06AF\u0626\u06D2 \u06C1\u06CC\u06BA\u060C \u0627\u0648\u0631 campus walk \u0622\u067E \u06A9\u0648 \u0627\u06CC\u06A9 \u0627\u06CC\u06A9 stop \u062F\u06A9\u06BE\u0627\u062A\u06CC \u06C1\u06D2\u06D4",
			"\u06A9\u0648\u0626\u06CC \u0628\u06BE\u06CC \u0633\u0648\u0627\u0644 \u06C1\u0648 \u062A\u0648 Ask HKBK \u067E\u0631 tap \u06A9\u0631 \u06A9\u06D2 \u0644\u06A9\u06BE\u06CC\u06BA \u06CC\u0627 \u0628\u0648\u0644\u06CC\u06BA\u06D4 Assistant \u0635\u0631\u0641 \u0627\u067E\u0646\u06D2 verified knowledge base \u0633\u06D2 \u062C\u0648\u0627\u0628 \u062F\u06CC\u062A\u0627 \u06C1\u06D2\u060C \u0627\u0648\u0631 \u062C\u0648 \u0646\u06C1\u06CC\u06BA \u062C\u0627\u0646\u062A\u0627 \u0648\u06C1 \u0635\u0627\u0641 \u06A9\u06C1\u06D2 \u062F\u06CC\u062A\u0627 \u06C1\u06D2\u06D4"
		]
	};

	/* Spoken notice when a language has no voice in this browser. */
	var NO_VOICE_NOTICE = {
		en: "This browser has no voice for that language, so here it is in English.",
		kn: "This browser has no Kannada voice, so here it is in English.",
		hi: "This browser has no Hindi voice, so here it is in English.",
		ur: "This browser has no Urdu voice, so here it is in English."
	};

	/* Firefox on Android reports three-letter codes (eng-US-f000); Android
	 * Chrome/Samsung use underscores (en_us). Normalise both. */
	var ISO3 = { eng: "en", hin: "hi", kan: "kn", urd: "ur" };
	function normLang(l) {
		l = String(l || "").replace("_", "-").toLowerCase();
		var head = l.split("-")[0];
		if (ISO3[head]) l = ISO3[head] + l.slice(3);
		return l;
	}
	function pickVoice(voices, speechCode) {
		if (!voices || !voices.length) return null;
		var i, v;
		for (i = 0; i < voices.length; i++) {
			v = voices[i];
			if (normLang(v.lang) === normLang(speechCode)) return v;
		}
		var prefix = normLang(speechCode).split("-")[0];
		for (i = 0; i < voices.length; i++) {
			v = voices[i];
			if (normLang(v.lang).indexOf(prefix) === 0) return v;
		}
		return null;
	}

	var currentUtterance = null;

	function cancel() {
		try { global.speechSynthesis && global.speechSynthesis.cancel(); } catch (e) {}
		currentUtterance = null;
	}

	/* speak(text, langCode, opts): opts.onend, opts.onmissing(langCode).
	 * When the chosen language has no voice, speaks opts.missingNotice (or the
	 * default notice) in English instead, then calls onmissing so the caller
	 * can show the text. Never throws; resolves false when unsupported. */
	function speak(text, langCode, opts) {
		opts = opts || {};
		if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) {
			if (opts.onmissing) opts.onmissing(langCode);
			if (opts.onend) opts.onend();
			return false;
		}
		var lang = null;
		for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === langCode) lang = LANGS[i];
		var speechCode = lang ? lang.speech : "en-IN";
		var voices = global.speechSynthesis.getVoices();
		var voice = pickVoice(voices, speechCode);
		var toSay = text, sayLang = speechCode;
		if (!voice && langCode !== "en") {
			voice = pickVoice(voices, "en-IN") || pickVoice(voices, "en-US") || voices[0] || null;
			toSay = (opts.missingNotice || NO_VOICE_NOTICE[langCode] || NO_VOICE_NOTICE.en) + " " + text;
			sayLang = voice ? voice.lang : "en-IN";
			if (opts.onmissing) opts.onmissing(langCode);
		}
		cancel();
		var u = new global.SpeechSynthesisUtterance(toSay);
		u.lang = sayLang;
		if (voice) u.voice = voice;
		u.rate = opts.rate || 1;
		if (opts.onend) u.onend = opts.onend;
		u.onerror = function () { if (opts.onend) opts.onend(); };
		currentUtterance = u;
		global.speechSynthesis.speak(u);
		return true;
	}

	/* Remembered choices (localStorage; fails soft). */
	var KEY_LANG = "hkbk-voice-lang", KEY_MUTED = "hkbk-voice-muted";
	function store(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }
	function read(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }

	var api = {
		LANGS: LANGS,
		SCRIPT: SCRIPT,
		NO_VOICE_NOTICE: NO_VOICE_NOTICE,
		pickVoice: pickVoice,
		speak: speak,
		cancel: cancel,
		getChoice: function () { return read(KEY_LANG); },
		setChoice: function (v) { store(KEY_LANG, v); },
		getMuted: function () { return read(KEY_MUTED) === "1"; },
		setMuted: function (m) { store(KEY_MUTED, m ? "1" : "0"); if (m) cancel(); }
	};

	api._normLang = normLang;

	/* Chrome populates the voice list asynchronously; warm it up and re-warm
	 * when it changes so the first utterance picks the right language. */
	if (global.speechSynthesis && global.speechSynthesis.addEventListener) {
		try {
			global.speechSynthesis.getVoices();
			global.speechSynthesis.addEventListener("voiceschanged", function () { global.speechSynthesis.getVoices(); });
		} catch (e) {}
	}

	if (typeof module !== "undefined" && module.exports) module.exports = api;
	global.HKBKVoice = api;
})(typeof window !== "undefined" ? window : globalThis);
