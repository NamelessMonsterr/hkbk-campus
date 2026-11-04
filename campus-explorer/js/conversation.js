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
				history: history.slice(-config.historyTurns)
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
		function reply(question) {
			var res = engine.ask(question);
			if (!config.endpoint || !fetchImpl) {
				return Promise.resolve({ text: res.answer, mode: "offline", engine: res, onlineError: null });
			}
			return onlineReply(res, question).then(function (text) {
				if (text) {
					history.push({ user: question, assistant: text });
					while (history.length > config.historyTurns) history.shift();
					return { text: text, mode: "online", engine: res, onlineError: null };
				}
				return { text: res.answer, mode: "offline", engine: res, onlineError: lastOnlineError };
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
