/*
 * conversation.js - the two-way conversation layer behind Talk to HKBK.
 *
 * Facts never come from a model. Every turn first runs the deterministic
 * engine (chatbot-engine.js); what the engine retrieves is the ONLY material
 * a phrasing model may use. Online mode (a configured proxy endpoint) sends
 * the question, the retrieved facts and the recent turns to the proxy, which
 * phrases a short spoken reply under cite-or-refuse rules. Offline mode -
 * the default, and every failure path - speaks the knowledge-base answer
 * verbatim. One request per turn, no automatic retries: a failed or
 * rate-limited call falls back to the offline answer instead of spending
 * quota again.
 *
 * No DOM here, so the whole layer is testable in Node with a mock fetch.
 */
(function (global) {
	"use strict";

	var DEFAULTS = { endpoint: "", timeoutMs: 8000, historyTurns: 6 };

	/* Speech recognition does not return clean typed text: it splits repeated
	 * words into segments ("hi hi"), drops or adds punctuation, and glues
	 * address terms on ("hey hkbk"). Normalize before any small-talk decision
	 * so the voice path and the typed path behave the same. */
	function normChatter(q) {
		var t = String(q || "").toLowerCase();
		t = t.replace(/[^\p{L}\p{N} ]/gu, " ");
		t = t.replace(/\s+/g, " ").trim();
		var w = t.split(" "), out = [];
		for (var i = 0; i < w.length; i++) if (w[i] && w[i] !== out[out.length - 1]) out.push(w[i]);
		t = out.join(" ");
		var dbl = /^(hi|hello|hey)\1$/.exec(t);   /* "hihi", "hellohello" from glued segments */
		if (dbl) t = dbl[1];
		return t;
	}

	/* Small talk needs no facts and no model: answered locally in both modes.
	 * Returns the reply text, or null when the turn is a real question.
	 * Matching stays anchored to the whole turn so real queries ("high
	 * cutoff", "hay fever hostel allergy") can never be swallowed. */
	function smallTalk(q) {
		var t = normChatter(q);
		if (!t) return null;
		if (/^(hi+|hello+|hey+|namaste|namaskara|salaam|vanakkam)( (there|hkbk|guide|sir|madam|everyone))?$/.test(t)
			|| /^good (morning|afternoon|evening|day)$/.test(t))
			return "Hi! Ask me anything about HKBK - courses, fees, campus life - or say: walk me through the campus.";
		if (/^(thanks|thank you|thankyou|thank u|thx|dhanyavad|dhanyavada|shukriya|thanks a lot|thank you so much)( (hkbk|guide))?$/.test(t))
			return "You're welcome! Anything else about the college?";
		if (/^(bye|goodbye|see you|tata|good night|goodnight)( (hkbk|guide|bye))?$/.test(t))
			return "Bye! Good luck with your college hunt.";
		if (/^(who are you|what are you|your name|what can you do|what do you do|help|help me)$/.test(t))
			return "I'm the HKBK guide. I answer questions about the college from its verified knowledge base, and I can walk you around the campus - just say so.";
		return null;
	}

	/* A turn that is not a question at all (a filler, a reaction, a mis-heard
	 * word) must not get the formal refusal with office contacts - that reads
	 * like a search box rejecting input, not a guide talking. Pivot warmly to
	 * what the guide can do. A turn that carries any question signal keeps
	 * the honest formal refusal: we do not have that fact, here is the
	 * office. Both wordings are local and deterministic; neither reaches the
	 * model. */
	var QUESTION_SIGNAL = /(what|when|where|who|whom|whose|how|why|which|tell|show|fee|fees|cost|price|charge|date|deadline|eligib|admiss|hostel|placement|course|branch|seat|cut ?off|rank|contact|number|phone|mail|address|facult|exam|scholarship|loan|document|certificate|bus|transport|canteen|food|mess|timing|location|reach|apply|quota|salary|package|company|companies|internship|\d)/;
	function chatterReply(q) {
		var t = normChatter(q);
		if (!t || t.split(" ").length > 5) return null;
		if (QUESTION_SIGNAL.test(t)) return null;
		return "I'm best with questions about HKBK - fees, admissions, campus life, placements. Try one of those, or say: walk me through the campus.";
	}


	function createConversation(options) {
		options = options || {};
		var engine = options.engine;
		if (!engine || typeof engine.ask !== "function") throw new Error("conversation needs an engine");
		var config = {};
		for (var k in DEFAULTS) config[k] = DEFAULTS[k];
		var src = options.config || (global.HKBK_TALK_CONFIG) || {};
		for (var k2 in src) config[k2] = src[k2];
		var fetchImpl = options.fetchImpl || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);

		var history = [];      // [{ user, assistant }] - this session only, never stored
		var lastOnlineError = null;

		/* Facts sent to the proxy: only what the engine actually retrieved,
		 * with the refusal wording and contacts so an out-of-scope reply uses
		 * the same honest words offline and online. */
		function factsFor(res) {
			var facts = [];
			if (res.type === "answer" && res.entryId) {
				facts.push({ id: res.entryId, category: res.category || null, text: res.answer });
			}
			if (res.type === "clarify" && res.suggestions) {
				for (var i = 0; i < res.suggestions.length; i++) {
					var s = res.suggestions[i];
					facts.push({ id: s.entryId, category: s.category || null, text: s.question });
				}
			}
			return facts;
		}

		function onlineReply(res, question) {
			var payload = {
				question: question,
				lang: res.lang || "en",
				outcome: res.type,               // answer | clarify | out_of_scope
				facts: factsFor(res),
				conflict: res.conflict ? true : false,
				refusal: res.type === "out_of_scope" ? res.answer : null,
				handoff: res.handoff || null,
				kbVersion: (res.source && res.source.kbVersion) || null,
				history: history.slice(-config.historyTurns),
				/* The visitor asked for a figure about a THING the retrieved
				 * facts never mention ("how many beds" vs a hostel blurb
				 * that says nothing about beds): the model must admit the
				 * gap, not rephrase unrelated text (rule 2 in the worker). */
				noFigures: (function () {
					var m = /how many (\w+)|how much (\w+)|(?:number|count) of (\w+)/i.exec(question);
					if (!m) return false;
					var noun = (m[1] || m[2] || m[3] || "").toLowerCase().replace(/s$/, "");
					if (noun.length < 3) return false;
					return factsFor(res).every(function (f) { return f.text.toLowerCase().indexOf(noun) === -1; });
				})()
			};
			var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
			var timedOut = false;
			var timer = null;
			if (ctl) {
				timer = setTimeout(function () { timedOut = true; ctl.abort(); }, config.timeoutMs);
			}
			var core = fetchImpl(config.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				signal: ctl ? ctl.signal : undefined
			}).then(function (r) {
				if (timer) clearTimeout(timer);
				if (!r.ok) { lastOnlineError = "http_" + r.status; return null; }
				return r.json().then(function (body) {
					if (!body || typeof body.reply !== "string" || !body.reply.trim()) {
						lastOnlineError = "empty_reply";
						return null;
					}
					return body.reply.trim();
				}).then(null, function () { lastOnlineError = "bad_json"; return null; });
			}, function () {
				if (timer) clearTimeout(timer);
				lastOnlineError = timedOut ? "timeout" : "network";
				return null;
			});
			if (!ctl) {
				/* No AbortController (older browser): race a promise-level
				 * timeout so a stalled request still falls back offline. */
				core = Promise.race([core, new Promise(function (resolve) {
					timer = setTimeout(function () { lastOnlineError = "timeout"; resolve(null); }, config.timeoutMs);
				})]);
			}
			return core;
		}

		/*
		 * reply(question) -> Promise<{
		 *   text: string,        what to speak and show
		 *   mode: "online"|"offline",
		 *   engine: result,      the raw engine result (section, walkStop, source...)
		 *   onlineError: string|null
		 * }>
		 */

		/* A conflicted fact must keep its caveat in voice too: when the KB
		 * answer does not already carry one, append the conflict note so the
		 * spoken/shown answer never reads as definitive. */
		function withConflict(res, text) {
			if (res.conflict && res.conflict.text && text.indexOf("disagree") === -1) return text + " " + res.conflict.text;
			return text;
		}

		function reply(question) {
			var small = smallTalk(question);
			if (small) {
				return Promise.resolve({ text: small, /* local in every mode: never label it online */ mode: "offline",
					engine: { type: "smalltalk", lang: "en", confidence: 1 }, onlineError: null });
			}
			var res;
			try {
				res = engine.ask(question);
			} catch (e) {
				return Promise.resolve({ text: "Something broke on my side. Try that again?", mode: "offline",
					engine: { type: "error", lang: "en" }, onlineError: "engine_error" });
			}
			if (res && res.type === "out_of_scope") {
				var pivot = chatterReply(question);
				if (pivot) {
					return Promise.resolve({ text: pivot, mode: "offline",
						engine: { type: "smalltalk", lang: res.lang || "en", confidence: 1 }, onlineError: null });
				}
			}
			if (!config.endpoint || !fetchImpl) {
				return Promise.resolve({ text: withConflict(res, res.answer), mode: "offline", engine: res, onlineError: null });
			}
			/* Grounding enforcement, page-side and deterministic: a refusal is
			 * never sent to the model for phrasing, so no worker/model fault can
			 * turn "I don't know" into a confident answer. The model only ever
			 * rephrases answers and clarifications built from KB facts. */
			if (res.type === "out_of_scope") {
				return Promise.resolve({ text: res.answer, mode: "online", engine: res, onlineError: null });
			}
			return onlineReply(res, question).then(function (text) {
				if (text) {
					history.push({ user: question, assistant: text });
					while (history.length > config.historyTurns) history.shift();
					return { text: text, mode: "online", engine: res, onlineError: null };
				}
				return { text: withConflict(res, res.answer), mode: "offline", engine: res, onlineError: lastOnlineError };
			});
		}

		return {
			reply: reply,
			history: function () { return history.slice(); },
			clear: function () { history = []; lastOnlineError = null; if (engine.endSession) engine.endSession(); },
			isOnline: function () { return !!(config.endpoint && fetchImpl); },
			lastError: function () { return lastOnlineError; }
		};
	}

	var api = { createConversation: createConversation, smallTalk: smallTalk, chatterReply: chatterReply };
	global.HKBKTalk = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
