/*
 * Node test harness for the Gemini Live client helpers (js/gemini-live.js).
 * Run: node tests/gemini-live-test.js
 * No network, no audio hardware: covers message shapes, PCM conversion,
 * server-message interpretation and tool dispatch/grounding payloads.
 */
"use strict";
var path = require("path");
var fs = require("fs");
var live = require(path.join(__dirname, "..", "js", "gemini-live.js"));
var Engine = require(path.join(__dirname, "..", "js", "chatbot-engine.js"));
var kb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "knowledge-base.json"), "utf8"));

var pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

section("Setup message");
var s = live.buildSetup({}).setup;
check("model is the official id, models/ prefixed", s.model === "models/gemini-3.8-live");
check("audio responses only", s.generationConfig.responseModalities.length === 1 && s.generationConfig.responseModalities[0] === "AUDIO");
check("transcription on both sides", !!s.inputAudioTranscription && !!s.outputAudioTranscription);
var names = s.tools[0].functionDeclarations.map(function (f) { return f.name; }).sort().join(",");
check("tools: lookup_hkbk, scroll_to, show_place, start_walk", names === "lookup_hkbk,scroll_to,show_place,start_walk", names);
check("prompt forces lookup_hkbk and forbids guessing", /MUST go through the lookup_hkbk/.test(s.systemInstruction.parts[0].text) && /Never guess/.test(s.systemInstruction.parts[0].text));
check("setup carries no key/token", JSON.stringify(s).indexOf("api") === -1 || !/AIza|AQ\./.test(JSON.stringify(s)));

section("PCM and base64");
var f = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
var p = live.floatToPcm16(f);
check("float->pcm16 clamps and scales", p[1] === 16383 && p[2] === -16384 && p[3] === 32767 && p[4] === -32768 && p[5] === 32767);
var back = live.pcm16ToFloat(p);
check("pcm16->float round trip within 1e-3", Math.abs(back[1] - 0.5) < 1e-3 && Math.abs(back[2] + 0.5) < 1e-3);
var ds = live.downsample(new Float32Array(48000).fill(0.25), 48000, 16000);
check("downsample 48k->16k yields 16000 samples", ds.length === 16000 && Math.abs(ds[100] - 0.25) < 1e-6);
check("downsample same rate is identity", live.downsample(f, 16000, 16000) === f);
var m = live.audioMessage(p);
check("audio message mime pcm 16k", m.realtimeInput.audio.mimeType === "audio/pcm;rate=16000");
var dec = live.bytesFromB64(m.realtimeInput.audio.data);
check("base64 round trip preserves bytes", dec.length === p.length * 2 && new Int16Array(dec.buffer)[3] === 32767);

section("Server message interpretation");
var a = live.b64FromBytes(new Uint8Array([1, 0, 2, 0]));
var ev = live.interpretServerMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: a } }] }, outputTranscription: { text: "hello" }, turnComplete: true } });
check("audio + transcript + turn_complete", ev.map(function (e) { return e.type; }).join() === "audio,model_text,turn_complete");
check("setupComplete -> ready", live.interpretServerMessage({ setupComplete: {} })[0].type === "ready");
check("interrupted flagged", live.interpretServerMessage({ serverContent: { interrupted: true } })[0].type === "interrupted");
check("input transcription -> user_text", live.interpretServerMessage({ serverContent: { inputTranscription: { text: "hi" } } })[0].text === "hi");
var tc = live.interpretServerMessage({ toolCall: { functionCalls: [{ id: "1", name: "start_walk", args: {} }] } });
check("tool call surfaced", tc.length === 1 && tc[0].type === "tool_call" && tc[0].call.id === "1");
check("goAway surfaced", live.interpretServerMessage({ goAway: { timeLeft: "5s" } })[0].type === "go_away");
check("garbage tolerated", live.interpretServerMessage(null).length === 0 && live.interpretServerMessage({}).length === 0);

section("Tool dispatch and grounding");
var acted = [];
var deps = {
	lookup: function (q) { return { echoed: q }; },
	act: function (a) { acted.push(a); return a.place !== "narnia"; }
};
var r = live.runTool({ name: "lookup_hkbk", args: { question: "hostel fee?" } }, deps);
check("lookup tool returns deps output", r.output.echoed === "hostel fee?");
check("show_place success", live.runTool({ name: "show_place", args: { place: "library" } }, deps).output.done === true);
check("show_place unknown place reports failure", live.runTool({ name: "show_place", args: { place: "narnia" } }, deps).output.done === false);
check("start_walk acts", live.runTool({ name: "start_walk" }, deps).output.done === true && acted.some(function (x) { return x.type === "start_walk"; }));
check("unknown tool is an error not a throw", live.runTool({ name: "rm_rf", args: {} }, deps).output.error === "unknown_tool");
check("throwing handler is contained", live.runTool({ name: "lookup_hkbk", args: {} }, { lookup: function () { throw new Error("x"); } }).output.error === "tool_failed");
var tr = live.toolResponseMessage("9", "lookup_hkbk", { found: true });
check("tool response message shape", tr.toolResponse.functionResponses[0].id === "9");

var engine = new Engine.Engine(kb);
var real = live.lookupPayload(engine.ask("what is the hostel fee"));
check("real KB question -> found with facts", real.found === true && real.facts[0].length > 10 && /hostel/i.test(real.facts[0]) && real.conflict === true && /disagree/.test(real.conflict_note), JSON.stringify(real).slice(0, 160));
var none = live.lookupPayload(engine.ask("who won the cricket world cup"));
check("off-topic -> not found, no invented facts", none.found === false && !none.facts);
check("off-topic payload carries refusal + office contacts", !!none.refusal_wording && !!none.contacts);
check("null engine result -> not found", live.lookupPayload(null).found === false);


section("Reconnect / resume (bounded)");
function run(failures) {
	var ev = [], calls = [];
	var s = new live.LiveSession({ onEvent: function (t) { ev.push(t); } });
	s.handle = "H1";
	var n = 0;
	s._connect = function (h) { calls.push(h); n++; return n <= failures ? Promise.reject(new Error("x")) : (s.ws = { close: function () {} }, Promise.resolve()); };
	var realSet = global.setTimeout; global.setTimeout = function (f) { return realSet(f, 1); };
	s._recover("go_away");
	return new Promise(function (res) { realSet(function () { global.setTimeout = realSet; res({ ev: ev, calls: calls }); }, 80); });
}
function runStopped() {
	var ev = [], calls = [];
	var s = new live.LiveSession({ onEvent: function (t) { ev.push(t); } });
	s.handle = "H1";
	s._connect = function (h) { calls.push(h); return Promise.reject(new Error("x")); };
	var realSet = global.setTimeout; global.setTimeout = function (f) { return realSet(f, 1); };
	s._recover("go_away");
	realSet(function () { s.stop(); }, 3);   /* page hidden / panel closed mid-retry */
	return new Promise(function (res) { realSet(function () { global.setTimeout = realSet; res({ ev: ev, calls: calls }); }, 80); });
}
Promise.all([run(0), run(2), run(5), runStopped()]).then(function (r) {
	check("clean recover: reconnecting then ready, resumed with the stored handle", r[0].ev.join() === "reconnecting,ready" && r[0].calls.join() === "H1");
	check("two failures then success: 3 attempts, ends ready", r[1].calls.length === 3 && r[1].ev[r[1].ev.length - 1] === "ready");
	check("never recovers: stops after exactly 3 attempts and reports closed", r[2].calls.length === 3 && r[2].ev[r[2].ev.length - 1] === "closed");
	check("stop() mid-retry: no further reconnect attempts, no events after close", r[3].calls.length === 1 && r[3].ev.join() === "reconnecting");
	console.log("\n  " + pass + " passed, " + fail + " failed");
	process.exit(fail ? 1 : 0);
});
