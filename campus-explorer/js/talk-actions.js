/*
 * talk-actions.js - turn what the visitor says into things the site does.
 *
 * Pure functions, no DOM: parse() looks at one spoken/typed line and returns
 * an action (open the walk, take me to a place, scroll the page to a
 * section, guide commands while a walk tour runs) or null when the line is
 * just a question for the conversation layer. Place names resolve against
 * the campus walk stops and the knowledge base's location entries, so
 * synonyms the KB knows ("admin block", "aiml block") work here too.
 */
(function (global) {
	"use strict";

	/* Words that mean "show me the place, don't just tell me". */
	var SHOW_CUE = /\b(show|open|take me|take us|go to|goto|walk to|walk through|bring me|see)\b/i;
	var WALK_CUE = /\b(walk|walkthrough|walk through|tour|guide me|show me around|around campus|around the campus)\b/i;

	var SECTION_WORDS = {
		programmes: ["programmes", "programs", "courses", "colleges"],
		departments: ["departments", "branches"],
		placements: ["placements", "recruiters", "packages"],
		campus: ["campus"],
		news: ["news", "events"],
		admissions: ["admissions", "admission", "apply", "fees", "fee", "eligibility"]
	};

	function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }

	/* Build the place index once per page: walk stops + KB location entries,
	 * keyed by every name/synonym we know for each place. */
	function buildIndex(kb, walkStops) {
		var places = [];
		var seen = {};
		function add(names, stopId, entryId) {
			var key = stopId || entryId;
			if (!key || seen[key]) return;
			seen[key] = true;
			places.push({ names: names.filter(Boolean).map(norm), stopId: stopId || null, entryId: entryId || null });
		}
		(walkStops || []).forEach(function (s) {
			if (s && s.step != null) add([s.name, s.id], s.id, null);
		});
		((kb && kb.entries) || []).forEach(function (e) {
			if (!e || e.category !== "location") return;
			/* The place name itself plus short question variants that ARE just
			 * the place name ("main gate", "admin block") - long question
			 * forms ("where do i enter the campus") stay out of name matching. */
			var names = [];
			if (e.walkStopName) names.push(e.walkStopName);
			if (e.en && e.en.q) {
				e.en.q.forEach(function (q) {
					if (String(q).split(/\s+/).length <= 3) names.push(q);
				});
			}
			add(names, e.walkStop || null, e.id);
		});
		return places;
	}

	function matchPlace(text, places) {
		var t = " " + norm(text) + " ";
		var best = null;
		for (var i = 0; i < places.length; i++) {
			var p = places[i];
			for (var j = 0; j < p.names.length; j++) {
				var n = p.names[j];
				if (n.length < 3) continue;
				/* strip question phrasing around the place name */
				if (t.indexOf(" " + n + " ") !== -1) {
					if (!best || n.length > best.name.length) best = { place: p, name: n };
				}
			}
		}
		return best ? best.place : null;
	}

	function matchSection(text) {
		var t = norm(text);
		for (var anchor in SECTION_WORDS) {
			var words = SECTION_WORDS[anchor];
			for (var i = 0; i < words.length; i++) {
				if (new RegExp("\\b" + words[i] + "\\b").test(t)) return anchor;
			}
		}
		return null;
	}

	var NEXT = /^(next|forward|go on|continue|move on|aage|next one)\b/i;
	var PREV = /^(back|previous|go back|last one)\b/i;
	var REPLAY = /^(repeat|say that again|again)\b/i;
	var STOP = /^(stop|pause|hold on|wait|enough|bas)\b/i;
	var END = /^(end|end tour|end the tour|quit|exit|close|that's all|thats all|done)\b/i;

	/*
	 * parse(text, ctx) -> action or null.
	 * ctx: { places: buildIndex result, guiding: bool (walk tour running) }
	 * Action shapes:
	 *   { type: "start_walk" }                 open the guided campus walk
	 *   { type: "show_place", stopId, entryId, name }
	 *   { type: "scroll", anchor }
	 *   { type: "guide_next" | "guide_prev" | "guide_repeat" | "guide_pause" | "guide_end" }
	 */
	function parse(text, ctx) {
		ctx = ctx || {};
		var t = String(text || "").trim();
		if (!t) return null;

		if (ctx.guiding) {
			if (END.test(t)) return { type: "guide_end" };
			if (NEXT.test(t)) return { type: "guide_next" };
			if (PREV.test(t)) return { type: "guide_prev" };
			if (REPLAY.test(t)) return { type: "guide_repeat" };
			if (STOP.test(t)) return { type: "guide_pause" };
			var gp = matchPlace(t, ctx.places || []);
			if (gp && gp.stopId && SHOW_CUE.test(t)) return { type: "guide_goto", stopId: gp.stopId };
			return null; // anything else is a question the conversation answers
		}

		if (WALK_CUE.test(t) && (SHOW_CUE.test(t) || /\b(start|begin|play|full|whole|complete|campus)\b/i.test(t))) {
			var wp = matchPlace(t, ctx.places || []);
			return { type: "start_walk", stopId: (wp && wp.stopId) || null };
		}
		var place = matchPlace(t, ctx.places || []);
		if (place && place.stopId && SHOW_CUE.test(t)) {
			return { type: "show_place", stopId: place.stopId, entryId: place.entryId || null };
		}
		if (SHOW_CUE.test(t)) {
			var sec = matchSection(t);
			if (sec) return { type: "scroll", anchor: sec };
		}
		return null;
	}

	var api = { buildIndex: buildIndex, parse: parse, _matchPlace: matchPlace, _matchSection: matchSection };
	global.HKBKTalkActions = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
