/*
 * Tests for Conversational Spatial Memory.
 *
 * Runs in bare Node - no browser, no WebGL, no Three.js. If this ever
 * needs a DOM, the render-agnostic separation has been broken.
 *
 *   node tests/scene-context-test.js
 */

var CSM = require("../js/3d/campus/scene-context.js");

var passed = 0, failed = 0;
function ok(label, cond) {
	if (cond) { passed++; console.log("  PASS  " + label); }
	else { failed++; console.log("  FAIL  " + label); }
}
function section(name) {
	console.log("\n== " + name + " " + Array(Math.max(2, 62 - name.length)).join("="));
}

var META = {
	"main-block": { id: "main-block", name: "Main Academic Block", position: [0, 0] },
	"library": { id: "library", name: "Library", position: [-11, -6] },
	"hostel": { id: "hostel", name: "Hostel", position: [12, -5] },
	"canteen": { id: "canteen", name: "Canteen", position: [-9, 8] },
	"admin": { id: "admin", name: "Admissions & Placement Cell", position: [10, 8] }
};

function decision(id, shot, intent) {
	return { targetId: id, shot: shot || "overview", intent: intent || "orientation" };
}

var NOW = 1000000;

section("Context lifecycle");
var ctx = CSM.create();
ok("a fresh context has no current building", ctx.currentBuilding === null);
ok("an empty context is not fresh", CSM.isFresh(ctx, NOW) === false);

CSM.record(ctx, decision("library", "entrance", "navigation"), NOW);
ok("recording sets the current building", ctx.currentBuilding === "library");
ok("recording stores the shot", ctx.lastShot === "entrance");
ok("recording stores the intent", ctx.lastIntent === "navigation");
ok("context is fresh immediately after recording", CSM.isFresh(ctx, NOW) === true);

CSM.record(ctx, decision("canteen", "context", "facilities"), NOW + 1000);
ok("the displaced building becomes previousBuilding", ctx.previousBuilding === "library");
ok("the new building becomes current", ctx.currentBuilding === "canteen");

CSM.record(ctx, decision("canteen", "detail", "architecture"), NOW + 2000);
ok("revisiting the same building does not shuffle history",
	ctx.previousBuilding === "library" && ctx.currentBuilding === "canteen");

ok("context expires after the TTL",
	CSM.isFresh(ctx, NOW + 2000 + CSM.CONTEXT_TTL_MS + 1) === false);

section("Reference resolution — grounded");
var g = CSM.create();
CSM.record(g, decision("library", "overview", "orientation"), NOW);

function ref(q) { return CSM.resolveReference(q, g, NOW + 500); }

ok("'how many books are there' grounds to the current building",
	ref("how many books are there").resolved === true && ref("how many books are there").targetId === "library");
ok("'is it open' grounds to the current building", ref("is it open").targetId === "library");
ok("'what are the timings here' grounds", ref("what are the timings here").targetId === "library");
ok("'take me inside' grounds", ref("take me inside").targetId === "library");
ok("'where is the entrance of this building' grounds", ref("where is the entrance of this building").targetId === "library");
ok("self reference is labelled as such", ref("is it open").kind === "self");
ok("'where is the entrance' grounds without naming a building",
	ref("where is the entrance").resolved === true && ref("where is the entrance").targetId === "library");
ok("'show me the roof' grounds", ref("show me the roof").targetId === "library");
ok("'what is on the ground floor' grounds", ref("what is on the ground floor").targetId === "library");

section("Reference resolution — no reference present");
var none = ref("what is the cet code");
ok("a query with no spatial reference is not grounded", none.resolved === false);
ok("and reports no reference kind", none.kind === null);
ok("'tell me about the campus' is not grounded to a building",
	ref("tell me about the campus").resolved === false);

section("Fails closed rather than guessing");
var cold = CSM.create();
var coldRef = CSM.resolveReference("how many books are there", cold, NOW);
ok("a reference with no context is not grounded", coldRef.resolved === false);
ok("and the reason says why", /nothing to ground/i.test(coldRef.reason));

var stale = CSM.create();
CSM.record(stale, decision("library"), NOW);
var staleRef = CSM.resolveReference("is it open", stale, NOW + CSM.CONTEXT_TTL_MS + 1);
ok("an expired context does not ground a reference", staleRef.resolved === false);
ok("and the reason says the context expired", /expired/i.test(staleRef.reason));

section("Relational and back-references");
ok("'what is nearby' is detected as a relational query", ref("what is nearby").kind === "nearby");
ok("'how far is the main block' is relational", ref("how far is the main block").kind === "nearby");
ok("relational queries ground to the current building", ref("what is nearby").targetId === "library");

var back = CSM.create();
CSM.record(back, decision("library"), NOW);
var noHistory = CSM.resolveReference("take me back", back, NOW + 100);
ok("'back' with no history is not resolved", noHistory.resolved === false);
ok("and explains that only one building has been visited", /only one building/i.test(noHistory.reason));

CSM.record(back, decision("hostel"), NOW + 200);
var withHistory = CSM.resolveReference("go back", back, NOW + 300);
ok("'back' resolves to the previous building", withHistory.resolved === true && withHistory.targetId === "library");
ok("'back' is labelled as such", withHistory.kind === "back");

section("Spatial relations");
var near = CSM.nearby("library", META, { limit: 3 });
ok("nearby returns the requested count", near.length === 3);
ok("nearby excludes the origin", near.every(function (n) { return n.id !== "library"; }));
ok("nearby is sorted by distance", near[0].distance <= near[1].distance && near[1].distance <= near[2].distance);
ok("nearby reports a distance", typeof near[0].distance === "number" && near[0].distance > 0);
ok("nearby reports a compass direction", typeof near[0].direction === "string" && near[0].direction.length > 2);

/* library at (-11,-6), main-block at (0,0): dx=+11, dz=+6 -> northeast */
var toMain = CSM.nearby("library", META, { limit: 4 }).filter(function (n) { return n.id === "main-block"; })[0];
ok("bearing from library to main block reads northeast", toMain.direction === "northeast");

/* canteen at (-9,8) is due north-ish of library at (-11,-6): dx=+2, dz=+14 */
var toCanteen = CSM.nearby("library", META, { limit: 4 }).filter(function (n) { return n.id === "canteen"; })[0];
ok("bearing from library to canteen reads north", toCanteen.direction === "north");

var bounded = CSM.nearby("library", META, { limit: 5, maxDistance: 13 });
ok("maxDistance filters distant buildings", bounded.every(function (n) { return n.distance <= 13; }));
ok("an unknown origin returns nothing rather than throwing", CSM.nearby("nope", META).length === 0);

section("Descriptions");
var desc = CSM.describeNearby(near);
ok("nearby description mentions a building", /Main Academic Block|Canteen|Hostel/.test(desc));
ok("nearby description avoids claiming metres", !/met(er|re)/i.test(desc));
ok("empty nearby list yields an honest sentence", CSM.describeNearby([]).length > 10);

var snapshot = CSM.describe(g, META, NOW + 3000);
ok("describe names the current building", snapshot.building === "Library");
ok("describe reports the last shot", snapshot.lastShot === "overview");
ok("describe reports context age", snapshot.ageSeconds === 3);
ok("describe returns null for an expired context",
	CSM.describe(g, META, NOW + CSM.CONTEXT_TTL_MS + 1) === null);

section("Clearing");
var toClear = CSM.create();
CSM.record(toClear, decision("hostel"), NOW);
CSM.clear(toClear);
ok("clear drops the current building", toClear.currentBuilding === null);
ok("clear drops history", toClear.previousBuilding === null);

console.log("\n== Result ====================================================");
console.log("  " + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
