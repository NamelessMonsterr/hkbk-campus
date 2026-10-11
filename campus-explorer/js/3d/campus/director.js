/*
 * Semantic Cinematic Director (SCD)
 * =================================
 *
 * Maps *why* a user asked something to *how* the campus should be framed
 * for them.
 *
 * The retrieval engine (js/chatbot-engine.js) already answers "what does
 * the user want to know". The building registry already answers "where is
 * it". Neither answers "what should the camera do about it" - until now
 * that was a single generic fly-to, identical for every query, which is
 * what nearly every 3D campus tour does.
 *
 * This module is the missing third step. Given a query and a resolved
 * spatial target, it classifies the *intent* behind the question and
 * selects a shot appropriate to it: an orientation question gets a wide
 * establishing frame, a navigation question gets the entrance in view at
 * approach height, an architecture question gets a low three-quarter
 * detail frame. Same building, different answers.
 *
 * DESIGN CONSTRAINT: this file imports nothing and knows nothing about
 * Three.js, meshes, materials or the DOM.
 *
 * It consumes plain metadata (bounds, entrance heading, landmarks) and
 * returns plain numbers (position, target, fov, duration, easing name).
 * The renderer interprets them. Three consequences, all deliberate:
 *   1. It is unit-testable in Node with no browser and no WebGL - see
 *      tests/director-test.js.
 *   2. Swapping the procedural boxes for real .glb models changes nothing
 *      here, because every shot is expressed relative to the bounding
 *      box rather than in absolute world coordinates.
 *   3. It is reusable for a campus that is not HKBK's - point it at
 *      different metadata and it works.
 *
 * HONEST SCOPE NOTE: intent classification here is a rule-based matcher
 * over keyword patterns with a scored fallback, NOT a learned classifier
 * and NOT an LLM. It is transparent and cheap and it fails predictably,
 * which is why every decision it makes carries a reason string. Do not
 * describe it as language understanding. The confidence it reports is a
 * pattern-match score, not a calibrated probability.
 */

(function (root, factory) {
	if (typeof module === "object" && module.exports) {
		module.exports = factory();
	} else {
		root.HKBKDirector = factory();
	}
}(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	var DEG = Math.PI / 180;

	/* ------------------------------------------------------------------ *
	 * Intent taxonomy.
	 *
	 * Shots are keyed by *intent*, not by camera name. "entrance" is a
	 * camera position; "navigation" is a reason. Keying on the reason is
	 * what lets the same building present differently to different
	 * questions, and it is the part that is actually being claimed as a
	 * contribution.
	 *
	 * `patterns` are matched against the lowercased query. `weight` breaks
	 * ties when several intents match - more specific intents outrank
	 * more general ones, so "where is the admissions office" resolves to
	 * navigation rather than administrative, since the user is asking to
	 * be taken there rather than asking about the department.
	 * ------------------------------------------------------------------ */
	var INTENTS = [
		{
			id: "navigation",
			weight: 1.0,
			label: "Navigation",
			patterns: [
				/\btake me\b/, /\bwhere\s+(is|are|can i find|do i)\b/, /\bhow do i (get|reach)\b/,
				/\bnavigate\b/, /\bdirections?\b/, /\bwhich way\b/, /\bentrance\b/, /\bgo to\b/,
				/\bfind\b/, /\breach\b/, /\bway to\b/
			],
			/* Directive phrasing is a stronger signal about *presentation*
			 * than topic keywords are. "Where is the admissions office"
			 * contains two administrative keywords and one navigation cue,
			 * but the user is asking to be taken somewhere, not asking
			 * about the department - so a bare keyword count picks the
			 * wrong framing. A directive hit adds a flat bonus so one
			 * explicit "where is" outranks accumulated topic words. */
			priorityPatterns: [
				/\btake me\b/, /\bwhere\s+(is|are|can i find|do i)\b/,
				/\bhow do i (get|reach)\b/, /\bgo to\b/, /\bway to\b/, /\bnavigate\b/
			],
			priorityBonus: 0.35,
			reason: "Navigation intent: the entrance and its approach must be visible, at a height that reads as arriving on foot."
		},
		{
			id: "architecture",
			weight: 0.95,
			label: "Architecture",
			patterns: [
				/\barchitect\w*\b/, /\bdesign\b/, /\bfacade\b/, /\bbuilt\b/, /\bstructure\b/,
				/\bwhat does it look like\b/, /\blook like\b/, /\bexterior\b/, /\bbuilding itself\b/,
				/\bhow (tall|big|large)\b/, /\bfloors?\b/, /\bstoreys?\b/, /\bstories\b/
			],
			reason: "Architecture intent: a low three-quarter frame reads the silhouette and facade rhythm better than a plan-like overview."
		},
		{
			id: "orientation",
			weight: 0.8,
			label: "Orientation",
			patterns: [
				/\bcampus\b/, /\boverview\b/, /\bshow me around\b/, /\bwhat('| i)s (here|there)\b/,
				/\blayout\b/, /\bmap\b/, /\btour\b/, /\bwhole\b/, /\beverything\b/,
				/\bhow big is\b/, /\baround\b/
			],
			reason: "Orientation intent: a high wide frame that places the target in relation to the rest of the campus."
		},
		{
			id: "facilities",
			weight: 0.9,
			label: "Facilities",
			patterns: [
				/\bfacilit\w*\b/, /\blab(s|oratory|oratories)?\b/, /\blibrar\w*\b/, /\bcanteen\b/,
				/\bmess\b/, /\bfood\b/, /\bhostel\b/, /\bsports?\b/, /\bgym\b/, /\bwifi\b/,
				/\bbooks?\b/, /\broom(s)?\b/, /\bamenit\w*\b/, /\bparking\b/
			],
			reason: "Facilities intent: a mid-distance contextual frame showing the target together with what surrounds it."
		},
		{
			id: "administrative",
			weight: 0.9,
			label: "Administrative",
			patterns: [
				/\badmission\w*\b/, /\bplacement\w*\b/, /\bfee(s)?\b/, /\boffice\b/, /\bapply\b/,
				/\badmin\w*\b/, /\benquir\w*\b/, /\bcontact\b/, /\bcut ?off\b/, /\bseat(s)?\b/,
				/\bscholarship\w*\b/, /\bdocument\w*\b/, /\bcet\b/, /\bcomedk\b/
			],
			reason: "Administrative intent: a steady eye-level frame on the block that handles the enquiry, close enough to read signage."
		}
	];

	var DEFAULT_INTENT = {
		id: "orientation",
		label: "Orientation",
		reason: "No specific intent matched, so the safest framing is a wide establishing shot that does not presume what the user wanted."
	};

	/* ------------------------------------------------------------------ *
	 * Shot library.
	 *
	 * Every value is RELATIVE to the target's bounding box, never an
	 * absolute world coordinate:
	 *   heading      degrees, relative to the building's entrance facing.
	 *                0 = directly in front of the entrance.
	 *   elevation    degrees above the horizon, from the look-at point.
	 *   distance     multiple of the box's footprint diagonal.
	 *   lookBias     fraction of building height the camera aims at.
	 *                Low values look at the base (good for entrances),
	 *                high values look at the mass (good for silhouettes).
	 *   fov          vertical field of view. A real lens change - a 28deg
	 *                long lens compresses and flatters a facade, a 62deg
	 *                wide lens exaggerates depth and shows context. Moving
	 *                the camera without changing the lens is the thing
	 *                that makes most web camera work feel samey.
	 *   allowOrbit   whether the user gets the controls back afterwards.
	 *   extentMode   which dimension `distance` multiplies.
	 *                "envelope" (default) uses the footprint diagonal, so
	 *                the whole building fits - right for wide shots.
	 *                "local" uses max(height, depth), so a shot stays close
	 *                enough to read an entrance or a facade detail on a
	 *                building that happens to be long. Added when the real
	 *                55 m-wide main block arrived: keying an entrance shot
	 *                off a 58 m diagonal parked the camera 110 m back and
	 *                the doors became invisible.
	 * ------------------------------------------------------------------ */
	var SHOTS = {
		overview: {
			name: "Overview",
			heading: 34, elevation: 26, distance: 2.6, lookBias: 0.55,
			fov: 55, duration: 2.8, ease: "easeInOutCubic", allowOrbit: true,
			extentMode: "envelope",
			composition: "Target placed off-centre against the campus mass behind it."
		},
		entrance: {
			name: "Entrance",
			heading: 6, elevation: 11, distance: 1.9, lookBias: 0.18,
			fov: 46, duration: 2.2, ease: "easeOutCubic", allowOrbit: true,
			extentMode: "local",
			composition: "Entrance on the near third, approach path leading in from frame edge."
		},
		detail: {
			name: "Architectural detail",
			heading: 52, elevation: 8, distance: 1.45, lookBias: 0.58,
			fov: 34, duration: 2.4, ease: "easeInOutCubic", allowOrbit: true,
			extentMode: "local",
			composition: "Low three-quarter view; long lens compresses the facade and keeps verticals near-parallel."
		},
		context: {
			name: "Context",
			heading: 40, elevation: 17, distance: 2.0, lookBias: 0.45,
			fov: 58, duration: 2.4, ease: "easeInOutCubic", allowOrbit: true,
			extentMode: "envelope",
			composition: "Wide enough to include neighbouring buildings and circulation between them."
		},
		administrative: {
			name: "Approach",
			heading: 16, elevation: 13, distance: 2.0, lookBias: 0.26,
			fov: 44, duration: 2.2, ease: "easeOutCubic", allowOrbit: true,
			extentMode: "local",
			composition: "Near eye level, square-on enough that signage and the door read clearly."
		},
		arrival: {
			name: "Arrival",
			heading: 22, elevation: 15, distance: 1.9, lookBias: 0.4,
			fov: 50, duration: 3.0, ease: "easeInOutCubic", allowOrbit: true,
			extentMode: "envelope",
			composition: "Neutral three-quarter establishing frame."
		}
	};

	/* Which shot serves which intent, and what to fall back to. The
	 * fallback chain matters: a building may not define an entrance
	 * heading, in which case an entrance shot would frame a blank wall,
	 * and a wrong-but-confident frame is worse than a neutral one. */
	var INTENT_SHOTS = {
		navigation: ["entrance", "arrival", "overview"],
		architecture: ["detail", "arrival", "overview"],
		orientation: ["overview", "context", "arrival"],
		facilities: ["context", "overview", "arrival"],
		administrative: ["administrative", "entrance", "arrival"]
	};

	/* ------------------------------------------------------------------ *
	 * Intent classification
	 * ------------------------------------------------------------------ */
	function classifyIntent(query) {
		var q = String(query || "").toLowerCase();
		var scored = [];

		INTENTS.forEach(function (intent) {
			var hits = 0;
			intent.patterns.forEach(function (re) { if (re.test(q)) hits++; });
			if (hits > 0) {
				/* Score saturates: three matching patterns is not three
				 * times the evidence of one, it is the same intent said
				 * three ways. */
				var raw = 1 - Math.pow(0.45, hits);
				var score = raw * intent.weight;
				var directive = false;
				if (intent.priorityPatterns) {
					for (var p = 0; p < intent.priorityPatterns.length; p++) {
						if (intent.priorityPatterns[p].test(q)) { directive = true; break; }
					}
				}
				if (directive) score = Math.min(1, score + intent.priorityBonus);
				scored.push({ intent: intent, score: score, hits: hits, directive: directive });
			}
		});

		if (!scored.length) {
			return {
				id: DEFAULT_INTENT.id, label: DEFAULT_INTENT.label,
				confidence: 0, reason: DEFAULT_INTENT.reason, matched: 0, fallback: true
			};
		}

		scored.sort(function (a, b) { return b.score - a.score; });
		var top = scored[0];
		var runnerUp = scored[1] ? scored[1].score : 0;

		return {
			id: top.intent.id,
			label: top.intent.label,
			confidence: Math.round(top.score * 100) / 100,
			margin: Math.round((top.score - runnerUp) * 100) / 100,
			reason: top.intent.reason,
			matched: top.hits,
			fallback: false,
			alternatives: scored.slice(1, 3).map(function (s) {
				return { id: s.intent.id, confidence: Math.round(s.score * 100) / 100 };
			})
		};
	}

	/* ------------------------------------------------------------------ *
	 * Shot selection + geometry
	 * ------------------------------------------------------------------ */
	function pickShot(intentId, meta) {
		var chain = INTENT_SHOTS[intentId] || INTENT_SHOTS.orientation;
		for (var i = 0; i < chain.length; i++) {
			var key = chain[i];
			if (key === "entrance" && !hasEntrance(meta)) continue;
			return { key: key, shot: SHOTS[key], degraded: i > 0, skipped: i };
		}
		return { key: "arrival", shot: SHOTS.arrival, degraded: true, skipped: chain.length };
	}

	function hasEntrance(meta) {
		return meta && typeof meta.entranceHeading === "number";
	}

	/* Camera placement. Spherical offset around the target, expressed in
	 * the building's own frame, then rotated into world space by the
	 * entrance heading. Everything scales off the footprint diagonal, so
	 * the same shot definition frames a 7m box and a 40m real model
	 * comparably. */
	function solveCamera(shot, meta) {
		var w = meta.bounds.width, h = meta.bounds.height, d = meta.bounds.depth;
		var extent = (shot.extentMode === "local")
			? Math.max(h, d)                        /* read a detail on a long building */
			: Math.sqrt(w * w + d * d);             /* fit the whole envelope */
		var dist = extent * shot.distance + h * 0.35;

		var facing = hasEntrance(meta) ? meta.entranceHeading : 0;
		var heading = (facing + shot.heading) * DEG;
		var elev = shot.elevation * DEG;

		var horizontal = Math.cos(elev) * dist;
		var target = {
			x: meta.position[0],
			y: h * shot.lookBias,
			z: meta.position[1]
		};
		var position = {
			x: target.x + Math.sin(heading) * horizontal,
			y: target.y + Math.sin(elev) * dist,
			z: target.z + Math.cos(heading) * horizontal
		};

		/* Never put the camera underground, whatever the elevation says. */
		if (position.y < 1.4) position.y = 1.4;

		return { position: position, target: target, distance: dist };
	}

	/* ------------------------------------------------------------------ *
	 * Public entry point
	 * ------------------------------------------------------------------ */
	function direct(options) {
		var query = options.query;
		var meta = options.target;
		if (!meta || !meta.bounds || !meta.position) {
			throw new Error("director: target metadata needs bounds and position");
		}

		var intent = options.forceIntent
			? { id: options.forceIntent, label: options.forceIntent, confidence: 1, reason: "Intent supplied directly by the caller.", matched: 0, fallback: false }
			: classifyIntent(query);

		var picked = pickShot(intent.id, meta);
		var cam = solveCamera(picked.shot, meta);

		var reason = intent.reason;
		if (picked.degraded) {
			reason += " The preferred shot for this intent was unavailable for "
				+ (meta.name || meta.id) + " (no entrance defined), so a neutral framing was substituted.";
		}

		return {
			intent: intent.id,
			intentLabel: intent.label,
			intentConfidence: intent.confidence,
			intentFallback: intent.fallback,
			alternatives: intent.alternatives || [],
			targetId: meta.id,
			targetName: meta.name || meta.id,
			shot: picked.key,
			shotName: picked.shot.name,
			shotDegraded: picked.degraded,
			composition: picked.shot.composition,
			reason: reason,
			camera: {
				position: cam.position,
				target: cam.target,
				fov: picked.shot.fov,
				duration: picked.shot.duration,
				ease: picked.shot.ease,
				allowOrbit: picked.shot.allowOrbit,
				distance: cam.distance
			}
		};
	}

	return {
		direct: direct,
		classifyIntent: classifyIntent,
		SHOTS: SHOTS,
		INTENTS: INTENTS,
		INTENT_SHOTS: INTENT_SHOTS
	};
}));
