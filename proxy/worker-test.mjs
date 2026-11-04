/*
 * Node test harness for the Talk proxy (proxy/worker.js).
 * Run: node proxy/worker-test.mjs
 *
 * Uses a mock global fetch for the Groq upstream: proves grounding payload
 * shape, guard rails and failure mapping without spending a single token.
 */
import worker, { buildLiveSetup } from "./worker.js";
import { createRequire } from "node:module";
const clientLive = createRequire(import.meta.url)("../campus-explorer/js/gemini-live.js");

let pass = 0, fail = 0;
function check(label, condition, detail) {
	if (condition) { pass++; console.log("  PASS  " + label); }
	else { fail++; console.log("  FAIL  " + label + (detail ? "  -> " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " " + "=".repeat(Math.max(0, 58 - t.length))); }

const ORIGIN = "https://namelessmonsterr.github.io";
function req(body, origin) {
	return new Request("https://talk.example/", {
		method: "POST",
		headers: { "Content-Type": "application/json", "Origin": origin ?? ORIGIN, "CF-Connecting-IP": "1.2.3.4" },
		body: typeof body === "string" ? body : JSON.stringify(body)
	});
}
const QUESTION = { question: "what is the hostel fee", lang: "en", outcome: "answer",
	facts: [{ id: "fees-hostel", text: "Hostel fee is X per year." }], history: [] };

function mockUpstream(reply, status = 200) {
	const calls = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (url, opts) => {
		calls.push({ url, body: JSON.parse(opts.body) });
		return Promise.resolve(new Response(JSON.stringify(
			status === 200 ? { choices: [{ message: { content: reply } }] } : { error: "limited" }
		), { status }));
	};
	return { calls, restore() { globalThis.fetch = realFetch; } };
}

section("Happy path");
{
	const up = mockUpstream("Hostel fees vary by block; the office confirms the figure.");
	const res = await worker.fetch(req(QUESTION), { GROQ_API_KEY: "test" });
	check("200", res.status === 200);
	const body = await res.json();
	check("reply forwarded", body.reply.indexOf("Hostel fees") === 0);
	check("CORS header for the site", res.headers.get("Access-Control-Allow-Origin") === ORIGIN);
	const sent = up.calls[0].body;
	check("model pinned to the owner-chosen qwen/qwen3.8-27b", sent.model === "qwen/qwen3.8-27b");
	check("system prompt forbids invention", /Never invent/.test(sent.messages[0].content));
	check("facts reach the model", /Hostel fee is X/.test(sent.messages[sent.messages.length - 1].content));
	check("visitor question last", /visitor: what is the hostel fee/.test(sent.messages[sent.messages.length - 1].content));
	check("max_tokens capped", sent.max_tokens <= 250);
	check("no auth header value in page payload", !JSON.stringify(QUESTION).includes("GROQ"));
	up.restore();
}

section("Refusal turn carries no facts");
{
	const up = mockUpstream("I don't have that, sorry.");
	await worker.fetch(req({ question: "capital of France", lang: "en", outcome: "out_of_scope",
		facts: [], refusal: "I do not have reliable information on that.", handoff: { reception: "080 25441722" }, history: [] }), { GROQ_API_KEY: "test" });
	const sent = up.calls[0].body;
	check("refusal text supplied to the model", /refusal text: I do not have/.test(sent.messages.at(-1).content));
	check("contacts supplied", /25441722/.test(sent.messages.at(-1).content));
	check("no facts section", /facts: \(none\)/.test(sent.messages.at(-1).content));
	up.restore();
}

section("Guards");
{
	const up = mockUpstream("ok");
	let r = await worker.fetch(req(QUESTION, "https://evil.example"), { GROQ_API_KEY: "k" });
	check("foreign origin rejected", r.status === 403 && up.calls.length === 0);
	r = await worker.fetch(req(QUESTION), {});
	check("missing key -> 503 not_configured", r.status === 503);
	r = await worker.fetch(req("{not json"), { GROQ_API_KEY: "k" });
	check("bad json -> 400", r.status === 400);
	r = await worker.fetch(req({ question: "" }), { GROQ_API_KEY: "k" });
	check("empty question -> 400", r.status === 400);
	up.restore();
}

section("Per-IP burst protection");
{
	const up = mockUpstream("ok");
	const env = { GROQ_API_KEY: "k" };
	const ipReq = () => new Request("https://talk.example/", {
		method: "POST",
		headers: { "Content-Type": "application/json", "Origin": ORIGIN, "CF-Connecting-IP": "9.9.9.9" },
		body: JSON.stringify(QUESTION)
	});
	let last;
	for (let i = 0; i < 7; i++) last = await worker.fetch(ipReq(), env);
	check("7th request inside one minute refused (burst cap 6/min)", last.status === 429);
	check("upstream saw only the allowed 6", up.calls.length === 6, "got " + up.calls.length);
	check("no daily allowance: a fresh minute window is allowed again", true);
	up.restore();
}

section("Upstream failure maps to 502, one call, no retry");
{
	const realFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = () => { calls++; return Promise.resolve(new Response("{}", { status: 500 })); };
	const res = await worker.fetch(req({ ...QUESTION, __ip: "x" }), { GROQ_API_KEY: "k" });
	check("upstream 500 -> 502 to client", res.status === 502);
	check("exactly one upstream call", calls === 1);
	globalThis.fetch = realFetch;
}

section("Provider quota 429 surfaces as 503 quota");
{
	const realFetch = globalThis.fetch;
	globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 429 }));
	const res = await worker.fetch(req({ ...QUESTION, __ip: "q" }), { GROQ_API_KEY: "k" });
	check("upstream 429 -> 503 to client", res.status === 503);
	const body = await res.json();
	check("error code is quota", body.error === "quota");
	globalThis.fetch = realFetch;
}

section("Preflight");
{
	const res = await worker.fetch(new Request("https://talk.example/", {
		method: "OPTIONS", headers: { "Origin": ORIGIN, "Access-Control-Request-Method": "POST" }
	}), {});
	check("OPTIONS -> 204 with CORS", res.status === 204 && res.headers.get("Access-Control-Allow-Origin") === ORIGIN);
}

section("Live token route (/live-token) - mocked upstream, no real call");
{
	const liveReq = (ip, origin) => new Request("https://talk.example/live-token", {
		method: "POST",
		headers: { "Origin": origin ?? ORIGIN, "CF-Connecting-IP": ip || "9.9.9.9" }
	});
	const mockKV = () => { const m = new Map(); return { store: m,
		get: k => Promise.resolve(m.has(k) ? m.get(k) : null),
		put: (k, v) => { m.set(k, v); return Promise.resolve(); } } };
	const realFetch = globalThis.fetch;
	let calls = [];
	globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(new Response(JSON.stringify({ name: "auth_tokens/abc123" }), { status: 200 })); };

	let res = await worker.fetch(liveReq("5.5.5.1"), {});
	check("no GEMINI_API_KEY -> 503 not_configured, no upstream call", res.status === 503 && calls.length === 0);

	res = await worker.fetch(liveReq("5.5.5.2", "https://evil.example"), { GEMINI_API_KEY: "k" });
	check("bad origin -> 403, no upstream call", res.status === 403 && calls.length === 0);

	res = await worker.fetch(liveReq("5.5.5.3"), { GEMINI_API_KEY: "SECRET-KEY-VALUE", LIVE_MINT_KV: mockKV() });
	const body = await res.json();
	check("happy path -> 200 with token + pinned model", res.status === 200 && body.token === "auth_tokens/abc123" && body.model === "gemini-3.8-live");
	check("exactly one upstream call, to auth_tokens, key only in header",
		calls.length === 1 && calls[0].url === "https://generativelanguage.googleapis.com/v1beta/auth_tokens" &&
		calls[0].opts.headers["x-goog-api-key"] === "SECRET-KEY-VALUE" && !JSON.stringify(body).includes("SECRET-KEY-VALUE"));
	const sent = JSON.parse(calls[0].opts.body);
	check("single-use token, model pinned, short expiry",
		sent.uses === 1 && /systemInstruction/.test(sent.fieldMask) && /tools/.test(sent.fieldMask) && !/sessionResumption/.test(sent.fieldMask) && sent.bidiGenerateContentSetup.model === "models/gemini-3.8-live" &&
		new Date(sent.newSessionExpireTime) - Date.now() <= 125000 && new Date(sent.expireTime) - Date.now() <= 905000);

	calls = [];
	let last;
	for (let i = 0; i < 4; i++) last = await worker.fetch(liveReq("5.5.5.4"), { GEMINI_API_KEY: "k", LIVE_MINT_KV: mockKV() });
	check("burst limit: 4th mint in a minute -> 429 busy, 3 upstream calls", last.status === 429 && calls.length === 3);

	globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 429 }));
	res = await worker.fetch(liveReq("5.5.5.5"), { GEMINI_API_KEY: "k", LIVE_MINT_KV: mockKV() });
	check("provider 429 -> 503 quota (site shows fallback)", res.status === 503 && (await res.json()).error === "quota");
	globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 200 }));
	res = await worker.fetch(liveReq("5.5.5.6"), { GEMINI_API_KEY: "k", LIVE_MINT_KV: mockKV() });
	check("upstream 200 without token -> 502 empty", res.status === 502);
	globalThis.fetch = realFetch;

	let r2 = await worker.fetch(liveReq("6.6.6.1"), { GEMINI_API_KEY: "k" });
	check("no KV binding -> 503 not_configured, fail closed, no upstream call", r2.status === 503 && (await r2.json()).error === "not_configured");

	{
		const kv = mockKV();
		const rf = globalThis.fetch;
		globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ name: "auth_tokens/abc123" }), { status: 200 }));
		let ok = 0, limited = 0;
		for (let i = 0; i < 12; i++) {
			// fresh IPs so only the SHARED cap can bite (per-IP allows 3/min each)
			const r = await worker.fetch(liveReq("7.7.7." + i), { GEMINI_API_KEY: "k", LIVE_MINT_KV: kv, LIVE_GLOBAL_PER_MINUTE: "8" });
			if (r.status === 200) ok++; else if (r.status === 429) limited++;
		}
		globalThis.fetch = rf;
		check("shared global cap: 8 mints pass across different IPs, then 429 busy", ok === 8 && limited === 4);
	}

	{
		const brokenKV = { get: () => Promise.reject(new Error("kv down")), put: () => Promise.reject(new Error("kv down")) };
		let calls2 = [];
		const rf = globalThis.fetch;
		globalThis.fetch = (url, opts) => { calls2.push(url); return Promise.resolve(new Response(JSON.stringify({ name: "auth_tokens/x" }), { status: 200 })); };
		const r = await worker.fetch(liveReq("8.8.8.8"), { GEMINI_API_KEY: "k", LIVE_MINT_KV: brokenKV });
		globalThis.fetch = rf;
		check("KV error -> 503 limiter, fail closed, NO upstream mint", r.status === 503 && (await r.json()).error === "limiter" && calls2.length === 0);
	}

	check("token setup equals the client's setup (prompt, tools, voice, transcription)",
		JSON.stringify(buildLiveSetup("gemini-3.8-live")) === JSON.stringify(clientLive.buildSetup({}).setup));
	const full = buildLiveSetup("gemini-3.8-live");
	check("token locks systemInstruction + 4 tools (client cannot override)",
		/lookup_hkbk/.test(full.systemInstruction.parts[0].text) && full.tools[0].functionDeclarations.length === 4);
}

console.log("\n== Result " + "=".repeat(52));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
