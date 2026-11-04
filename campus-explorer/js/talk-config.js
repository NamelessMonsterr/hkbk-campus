/*
 * talk-config.js - deployment settings for Talk to HKBK.
 *
 * endpoint: URL of the conversation proxy (proxy/worker.js, a Cloudflare
 * Worker). EMPTY STRING means offline mode: every reply is composed from the
 * on-device knowledge base only, exactly like the chat panel, and no question
 * ever leaves the device. That is the shipped default ON main, and it is what the
 * submitted paper describes. This preview branch wires the deployed proxy
 * URL here so the online assistant can be tested; the page itself never
 * holds a key. Do not merge to main until the owner approves the preview.
 */
(function (global) {
	"use strict";
	var config = {
		endpoint: "https://hkbk-talk.hkbk-campus.workers.dev",
		timeoutMs: 8000,
		historyTurns: 6
	};
	global.HKBK_TALK_CONFIG = config;
	if (typeof module !== "undefined" && module.exports) module.exports = config;
})(typeof window !== "undefined" ? window : globalThis);
