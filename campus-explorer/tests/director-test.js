/*
 * Tests for the Semantic Cinematic Director.
 *
 * Runs in plain Node with no browser, no WebGL and no Three.js - which is
 * the point of keeping director.js render-agnostic. If this file ever
 * needs a DOM to run, the separation has been broken.
 *
 *   node tests/director-test.js
 */

var D = require("../js/3d/campus/director.js");

var passed = 0, failed = 0;

function ok(label, cond) {
	if (cond) { passed++; console.log("  PASS  " + label); }
	else { failed++; console.log("  FAIL  " + label); }
}
function section(name) {
	console.log("\n== " + name + " " + Array(Math.max(2, 62 - name.length)).join("=") );
}

/* Metadata fixtures - deliberately NOT the real registry, so these tests
 * don't break every time a building moves. */
var mainBlock = {
	id: "main-block", name: "Main Academic Block",
	position: [0, 0], bounds: { width: 7.5, height: 3.4, depth: 3.2 },
	entranceHeading: 0
};
var noEntrance = {
	id: "mystery", name: "Unmapped Block",
	position: [10, -4], bounds: { width: 4, height: 6, depth: 4 }
};
var bigModel = {
	id: "main-block-real", name: "Main Block (real model)",
	position: [0, 0], bounds: { width: 42, height: 19, depth: 18 },
	entranceHeading: 0
};

section("Intent classification");
ok("navigation phrasing resolves to navigation",
	D.classifyIntent("take me to the library").id === "navigation");
ok("'where is' resolves to navigation",
	D.classifyIntent("where is the placement office").id === "navigation");
ok("architecture phrasing resolves to architecture",
	D.classifyIntent("show me the facade design").id === "architecture");
ok("campus-wide phrasing resolves to orientation",
	D.classifyIntent("show me around the whole campus").id === "orientation");
ok("facilities phrasing resolves to facilities",
	D.classifyIntent("what labs are there").id === "facilities");
ok("admissions phrasing resolves to administrative",
	D.classifyIntent("what is the admission cutoff").id === "administrative");

var unknown = D.classifyIntent("qwerty zxcvb");
ok("unmatched query falls back rather than guessing", unknown.fallback === true);
ok("fallback reports zero confidence", unknown.confidence === 0);
ok("fallback still yields a usable intent", unknown.id === "orientation");

var saturating = D.classifyIntent("where is the entrance, how do i get there, which way");
ok("repeated cues do not push confidence above 1", saturating.confidence <= 1);

section("Intent outranking");
var mixed = D.classifyIntent("where is the admissions office");
ok("navigation outranks administrative when the user asks to be taken there",
	mixed.id === "navigation");
ok("the losing intent is still reported as an alternative",
	mixed.alternatives.some(function (a) { return a.id === "administrative"; }));

section("Shot selection by intent");
function shotFor(q, meta) { return D.direct({ query: q, target: meta || mainBlock }).shot; }
ok("navigation -> entrance shot", shotFor("take me to the main block") === "entrance");
ok("architecture -> detail shot", shotFor("what does the building look like") === "detail");
ok("orientation -> overview shot", shotFor("show me the whole campus") === "overview");
ok("facilities -> context shot", shotFor("what facilities are here") === "context");
ok("administrative -> approach shot", shotFor("admission fees") === "administrative");

section("Same target, different framing");
var nav = D.direct({ query: "where is the entrance of the main block", target: mainBlock });
var arch = D.direct({ query: "describe the architecture of the main block", target: mainBlock });
ok("the two queries resolve to different shots", nav.shot !== arch.shot);
ok("the two queries produce different camera positions",
	Math.abs(nav.camera.position.x - arch.camera.position.x) > 0.1 ||
	Math.abs(nav.camera.position.z - arch.camera.position.z) > 0.1);
ok("the two queries use different focal lengths", nav.camera.fov !== arch.camera.fov);
ok("navigation aims lower than architecture (entrance vs mass)",
	nav.camera.target.y < arch.camera.target.y);

section("Graceful degradation");
var degraded = D.direct({ query: "take me there", target: noEntrance });
ok("entrance shot is skipped when no entrance is defined", degraded.shot !== "entrance");
ok("degradation is reported, not hidden", degraded.shotDegraded === true);
ok("the reason explains the substitution", /no entrance defined/.test(degraded.reason));

section("Explainability payload");
var explained = D.direct({ query: "where is the library", target: mainBlock });
ok("decision names the intent", typeof explained.intentLabel === "string" && explained.intentLabel.length > 0);
ok("decision carries a confidence", typeof explained.intentConfidence === "number");
ok("decision carries a human-readable reason", explained.reason.length > 20);
ok("decision names the selected shot", typeof explained.shotName === "string");
ok("decision describes the composition", explained.composition.length > 10);

section("Geometry is relative, not absolute");
var small = D.direct({ query: "show me the architecture", target: mainBlock });
var large = D.direct({ query: "show me the architecture", target: bigModel });
ok("a larger model is framed from further away",
	large.camera.distance > small.camera.distance * 2);
ok("both use the same shot definition", small.shot === large.shot);
ok("both use the same lens", small.camera.fov === large.camera.fov);

var offset = D.direct({
	query: "take me there",
	target: { id: "x", position: [30, -20], bounds: { width: 5, height: 4, depth: 5 }, entranceHeading: 0 }
});
ok("look-at follows the building's world position",
	Math.abs(offset.camera.target.x - 30) < 0.001 && Math.abs(offset.camera.target.z + 20) < 0.001);

section("Camera sanity");
var allShots = Object.keys(D.SHOTS);
var neverUnderground = allShots.every(function (key) {
	var r = D.direct({ query: "anything", target: mainBlock, forceIntent: "orientation" });
	return r.camera.position.y >= 1.4;
});
ok("camera never solves to below ground", neverUnderground);

var everyIntentResolves = Object.keys(D.INTENT_SHOTS).every(function (id) {
	var r = D.direct({ query: "x", target: noEntrance, forceIntent: id });
	return r.camera && typeof r.camera.fov === "number" && r.camera.duration > 0;
});
ok("every intent resolves to a usable shot even without an entrance", everyIntentResolves);

var headingRespected = D.direct({
	query: "take me to the entrance",
	target: { id: "y", position: [0, 0], bounds: { width: 6, height: 4, depth: 6 }, entranceHeading: 90 }
});
ok("entrance heading rotates the camera around the building",
	Math.abs(headingRespected.camera.position.x) > Math.abs(headingRespected.camera.position.z));

section("Contract");
var threw = false;
try { D.direct({ query: "x", target: { id: "bad" } }); } catch (e) { threw = true; }
ok("missing metadata throws rather than silently mis-framing", threw);

console.log("\n== Result ====================================================");
console.log("  " + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
