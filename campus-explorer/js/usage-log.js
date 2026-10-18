/*
 * Opt-in anonymous usage log (2026-10).
 *
 * Off by default. When the user opts in, the chat logs OUTCOMES ONLY:
 * entry id, category, outcome type, confidence band, latency - never the
 * question text, never a name, never anything typed. Device-local
 * (localStorage hkbk_usage, capped at 500 events), exportable only by the
 * user from the admin view. Opt out any time; opting out deletes the log.
 */
(function (global) {
	"use strict";
	var OPTIN = "hkbk_usage_optin";
	var LOG = "hkbk_usage";
	var CAP = 500;

	function choice() {
		try { return localStorage.getItem(OPTIN); } catch (e) { return "no"; }
	}
	function setChoice(v) {
		try {
			localStorage.setItem(OPTIN, v);
			if (v !== "yes") localStorage.removeItem(LOG);
		} catch (e) {}
	}
	function enabled() { return choice() === "yes"; }

	function log(type, data) {
		if (!enabled()) return;
		try {
			var v = JSON.parse(localStorage.getItem(LOG)) || [];
			var ev = { ts: new Date().toISOString(), type: type };
			if (data) Object.keys(data).forEach(function (k) { ev[k] = data[k]; });
			v.push(ev);
			if (v.length > CAP) v = v.slice(v.length - CAP);
			localStorage.setItem(LOG, JSON.stringify(v));
		} catch (e) {}
	}

	/* confidence reported as a band, not the exact score */
	function band(conf) {
		if (conf == null) return null;
		if (conf < 0.15) return "<0.15";
		if (conf < 0.25) return "0.15-0.25";
		if (conf < 0.5) return "0.25-0.5";
		return ">=0.5";
	}

	global.HKBKUsage = { log: log, enabled: enabled, choice: choice, setChoice: setChoice, band: band };
})(typeof window !== "undefined" ? window : this);
