/*
 * Conversational Spatial Memory (CSM)
 * ===================================
 *
 * Grounds follow-up questions in whatever the user is currently looking
 * at, so "how many books are there" resolves to the library without the
 * user having to say "library" again.
 *
 * SCOPE, deliberately small. This is NOT a memory system:
 *   - no embeddings, no vector store, no LLM context window
 *   - no long-term memory, nothing persisted anywhere
 *   - no conversation history beyond one previous target
 *
 * It is a handful of fields describing the *scene*, plus a resolver that
 * maps deictic words ("there", "it", "this building", "here") onto them.
 * The retrieval engine already handles topical follow-ups through its own
 * 10-turn buffer; this handles *spatial* ones, which that buffer cannot,
 * because it has no idea where the camera is.
 *
 * DESIGN CONSTRAINT: like director.js, this file imports nothing and knows
 * nothing about Three.js, meshes or the DOM. It takes plain metadata and
 * returns plain data, which is why tests/scene-context-test.js runs in
 * bare Node.
 *
 * HONEST SCOPE NOTE: reference resolution is pattern-based, not
 * coreference resolution in the NLP sense. It matches a fixed list of
 * deictic and pronominal forms. It will not resolve "the one with the
 * glass front" or "the building I asked about before last". It fails
 * closed - when it cannot ground a reference it says so rather than
 * guessing at the most recent target, because a confidently wrong
 * grounding is worse than an admitted miss.
 */

(function (root, factory) {
	if (typeof module === "object" && module.exports) {
		module.exports = factory();
	} else {
		root.HKBKSceneContext = factory();
	}
}(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	/* How long a scene context stays valid. After this, "there" is
	 * genuinely ambiguous again - the user has almost certainly moved on,
	 * and silently grounding a reference to something they looked at five
	 * minutes ago is exactly the kind of confident-but-wrong behaviour
	 * this module is supposed to avoid. */
	var CONTEXT_TTL_MS = 5 * 60 * 1000;

	/* Deictic and pronominal forms that refer to the current scene. Kept
	 * as an explicit list rather than "any pronoun", because "what are the
	 * fees" contains no reference at all and must not be grounded. */
	var SELF_REFERENCE = [
		/\bthere\b/, /\bhere\b/, /\bthis (building|block|place|one)\b/,
		/\bthat (building|block|place|one)\b/, /\bit(s)?\b/, /\bthis\b(?!\s+(college|campus))/,
		/\binside\b/, /\bthe building\b/, /\bthe place\b/,
		/* Parts of a building are implicitly relative: "where is the
		 * entrance" only means anything if something is currently in view.
		 * If the user names a building too, explicit matching wins before
		 * this module is ever consulted. */
		/\b(the )?(entrance|doorway|lobby|reception|foyer|roof|rooftop|upstairs|ground floor)\b/
	];

	var NEARBY_REFERENCE = [
		/\bnearby\b/, /\bnear (here|there|it|this)\b/, /\baround (here|there|it|this)\b/,
		/\bclose (to|by)\b/, /\bnext to\b/, /\bwhat else is\b/, /\bsurround\w*\b/,
		/\bwhat('s| is) around\b/, /\bneighbou?r\w*\b/, /\bhow far\b/
	];

	function create() {
		return {
			currentBuilding: null,
			previousBuilding: null,
			lastShot: null,
			lastIntent: null,
			timestamp: 0
		};
	}

	function isFresh(ctx, now) {
		if (!ctx || !ctx.currentBuilding) return false;
		return ((now || Date.now()) - ctx.timestamp) < CONTEXT_TTL_MS;
	}

	/* Called after every Director decision - this is the only way context
	 * is ever written. Note that revisiting the same building does NOT
	 * shuffle it into previousBuilding; "go back" should return somewhere
	 * genuinely different. */
	function record(ctx, decision, now) {
		if (!ctx || !decision) return ctx;
		if (decision.targetId !== ctx.currentBuilding) {
			ctx.previousBuilding = ctx.currentBuilding;
		}
		ctx.currentBuilding = decision.targetId;
		ctx.lastShot = decision.shot;
		ctx.lastIntent = decision.intent;
		ctx.timestamp = (typeof now === "number") ? now : Date.now();
		return ctx;
	}

	function clear(ctx) {
		var fresh = create();
		if (!ctx) return fresh;
		Object.keys(fresh).forEach(function (k) { ctx[k] = fresh[k]; });
		return ctx;
	}

	function matchesAny(patterns, q) {
		for (var i = 0; i < patterns.length; i++) {
			if (patterns[i].test(q)) return true;
		}
		return false;
	}

	/* ------------------------------------------------------------------ *
	 * Reference resolution
	 *
	 * Returns { resolved, targetId, kind, reason }. `kind` is "self" for
	 * a reference to the current building, "nearby" for a relational
	 * query, "back" for a return to the previous one, null for no
	 * reference detected.
	 * ------------------------------------------------------------------ */
	function resolveReference(query, ctx, now) {
		var q = String(query || "").toLowerCase();

		var wantsBack = /\b(go |take me )?back\b/.test(q) || /\bprevious (building|block|one)\b/.test(q);
		var wantsNearby = matchesAny(NEARBY_REFERENCE, q);
		var wantsSelf = matchesAny(SELF_REFERENCE, q);

		if (!wantsBack && !wantsNearby && !wantsSelf) {
			return { resolved: false, targetId: null, kind: null, reason: "No spatial reference in the query." };
		}

		if (!isFresh(ctx, now)) {
			/* Fails closed on purpose. */
			return {
				resolved: false, targetId: null,
				kind: wantsNearby ? "nearby" : (wantsBack ? "back" : "self"),
				reason: ctx && ctx.currentBuilding
					? "A spatial reference was used but the scene context has expired, so it was not grounded."
					: "A spatial reference was used before any building had been visited, so there is nothing to ground it to."
			};
		}

		if (wantsBack) {
			if (!ctx.previousBuilding) {
				return {
					resolved: false, targetId: null, kind: "back",
					reason: "Nothing to go back to - only one building has been visited."
				};
			}
			return {
				resolved: true, targetId: ctx.previousBuilding, kind: "back",
				reason: "\"back\" grounded to the previously visited building."
			};
		}

		if (wantsNearby) {
			return {
				resolved: true, targetId: ctx.currentBuilding, kind: "nearby",
				reason: "Relational query grounded to the building currently in view."
			};
		}

		return {
			resolved: true, targetId: ctx.currentBuilding, kind: "self",
			reason: "Reference grounded to the building currently in view."
		};
	}

	/* ------------------------------------------------------------------ *
	 * Spatial relations
	 *
	 * Distances are in world units. The caller decides whether to present
	 * them as metres - the campus model is not surveyed, so this module
	 * deliberately does not claim a unit.
	 * ------------------------------------------------------------------ */
	var COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

	function bearingLabel(dx, dz) {
		/* +z is treated as north to match the Director's heading
		 * convention (0 degrees = +z). */
		var angle = Math.atan2(dx, dz) * 180 / Math.PI;
		if (angle < 0) angle += 360;
		var idx = Math.round(angle / 45) % 8;
		return COMPASS[idx];
	}

	function nearby(originId, metaById, options) {
		var opts = options || {};
		var limit = opts.limit || 3;
		var origin = metaById[originId];
		if (!origin) return [];

		var out = [];
		Object.keys(metaById).forEach(function (id) {
			if (id === originId) return;
			var m = metaById[id];
			var dx = m.position[0] - origin.position[0];
			var dz = m.position[1] - origin.position[1];
			var dist = Math.sqrt(dx * dx + dz * dz);
			if (opts.maxDistance && dist > opts.maxDistance) return;
			out.push({
				id: id,
				name: m.name || id,
				distance: Math.round(dist * 10) / 10,
				direction: bearingLabel(dx, dz)
			});
		});

		out.sort(function (a, b) { return a.distance - b.distance; });
		return out.slice(0, limit);
	}

	/* A short, honest sentence about what is around. Deliberately says
	 * "units" rather than "metres" - see note above. */
	function describeNearby(list) {
		if (!list.length) return "Nothing else is close enough to be worth pointing at.";
		return list.map(function (n) {
			return n.name + " is about " + n.distance + " units " + n.direction;
		}).join(", ") + ".";
	}

	/* What a demo or research-mode panel displays. */
	function describe(ctx, metaById, now) {
		if (!isFresh(ctx, now)) return null;
		var m = metaById && metaById[ctx.currentBuilding];
		return {
			building: (m && m.name) || ctx.currentBuilding,
			buildingId: ctx.currentBuilding,
			previous: ctx.previousBuilding,
			lastShot: ctx.lastShot,
			lastIntent: ctx.lastIntent,
			ageSeconds: Math.round((((typeof now === "number") ? now : Date.now()) - ctx.timestamp) / 1000)
		};
	}

	return {
		create: create,
		record: record,
		clear: clear,
		isFresh: isFresh,
		resolveReference: resolveReference,
		nearby: nearby,
		describeNearby: describeNearby,
		describe: describe,
		CONTEXT_TTL_MS: CONTEXT_TTL_MS
	};
}));
