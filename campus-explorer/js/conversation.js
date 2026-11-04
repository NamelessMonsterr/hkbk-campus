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
			return fetchImpl(config.endpoint, {
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
				});
			}, function () {
				if (timer) clearTimeout(timer);
				lastOnlineError = timedOut ? "timeout" : "network";
				return null;
			});
		}

		/*
		 * reply(question) -> Promise<{
		 *   text: string,        what to speak and show
		 *   mode: "online"|"offline",
		 *   engine: result,      the raw engine result (section, walkStop, source...)
		 *   onlineError: string|null
		 * }>
		 */

	/* Small talk needs no facts and no model: answered locally in both modes.
	 * Returns the reply text, or null when the turn is a real question. */
	function smallTalk(q) {
		var t = String(q || "").trim().toLowerCase().replace(/[!.?]+$/g, "");
		if (/^(hi+|hello|hey|namaste|namaskara|good (morning|afternoon|evening))$/.test(t))
			return "Hi! Ask me anything about HKBK - courses, fees, campus life - or say: walk me through the campus.";
		if (/^(thanks|thank you|thankyou|thx|thank u|dhanyavad|shukriya)$/.test(t))
			return "You're welcome! Anything else about the college?";
		if (/^(bye|goodbye|see you|tata|good night)$/.test(t))
			return "Bye! Good luck with your college hunt.";
		if (/^(who are you|what are you|your name|what can you do)$/.test(t))
			return "I'm the HKBK guide. I answer questions about the college from its verified knowledge base, and I can walk you around the campus - just say so.";
		return null;
	}

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
				return Promise.resolve({ text: small, mode: config.endpoint && fetchImpl ? "online" : "offline",
					engine: { type: "smalltalk", lang: "en", confidence: 1 }, onlineError: null });
			}
			var res = engine.ask(question);
			if (!config.endpoint || !fetchImpl) {
				return Promise.resolve({ text: withConflict(res, res.answer), mode: "offline", engine: res, onlineError: null });
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

	var api = { createConversation: createConversation };
	global.HKBKTalk = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
