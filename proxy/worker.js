/*
 * HKBK Talk proxy (Cloudflare Worker, free plan).
 *
 * One job: phrase a short spoken reply from facts the site's deterministic
 * engine already retrieved. The Groq key lives here as a Worker secret
 * (GROQ_API_KEY) - it never touches the page, the repo, or the visitor's
 * device beyond this one request.
 *
 * Grounding rules are enforced in the system prompt: the model receives only
 * the retrieved knowledge-base entries and must answer from them or refuse
 * with the provided fallback words. Cost guards: a per-request question
 * length cap (payload size limit, not an allowance), a per-IP per-minute
 * burst limit (best-effort in-memory per isolate - documented, not claimed
 * as exact), small max_tokens, one upstream call per request, no retries,
 * no logging of question text. The real quota is the provider's own org
 * limit; when it is spent the site openly shows its local fallback.
 *
 * Deploy: see proxy/README.md. Not deployed until the owner says so.
 */

const ALLOWED_ORIGINS = [
	"https://namelessmonsterr.github.io",
	"https://talk-mode.hkbk-campus-preview.pages.dev",  // preview branch alias (not the live site)
	"https://talk-mode-v2.hkbk-campus-preview.pages.dev",  // versioned fix preview (year-speech)
	"https://talk-mode-v3.hkbk-campus-preview.pages.dev",  // versioned fix preview (Indian voice preference)
	"https://talk-mode-v4.hkbk-campus-preview.pages.dev",  // versioned fix preview (regenerated tour audio)
	"https://talk-mode-v5.hkbk-campus-preview.pages.dev",  // versioned fix preview (follow-up anchoring + walk resume)
	"http://localhost",
	"http://127.0.0.1"
];
const MODEL = "qwen/qwen3.8-27b";  // owner-chosen 2026-11-04; override via the MODEL worker var
const UPSTREAM = "https://api.groq.com/openai/v1/chat/completions";

const MAX_QUESTION_CHARS = 1200;
const MAX_TOKENS = 220;          // short spoken replies
// Abuse protection is a BURST limit, not an allowance: a visitor talking to
// a voice assistant produces a turn every few seconds at most, so 6 calls a
// minute per IP stops scripts and pocket-dials without ever touching a real
// conversation. There is deliberately NO daily visitor or global cap here:
// the actual quota is the provider's own org limit (Groq free tier, 1,000
// requests/day org-wide as verified 2026-11-04), which the key shares with
// other projects. When that quota is spent, Groq answers 429, the worker
// passes the state through, and the site openly shows its local-answers
// fallback - no hidden rationing, no fake AI replies.
// The burst rate is owner-adjustable via the PER_IP_PER_MINUTE worker var.
const PER_IP_PER_MINUTE = 6;
const UPSTREAM_TIMEOUT_MS = 6000;

// Best-effort in-memory buckets. A Worker isolate resets under load or
// eviction, so these undercount at worst - a burst may straddle two
// isolates, which is acceptable for abuse protection.
const ipBuckets = new Map();   // ip -> { windowStart, count }

function allow(ip, perMinute) {
	const now = Date.now();
	let b = ipBuckets.get(ip);
	if (!b || now - b.windowStart >= 60000) { b = { windowStart: now, count: 0 }; ipBuckets.set(ip, b); }
	if (b.count >= perMinute) return false;
	b.count++;
	// keep the map small: evict the stalest buckets, never reset everyone
	// (a global clear would let an attacker erase every active limit at once)
	if (ipBuckets.size > 5000) {
		for (const [k, v] of ipBuckets) {
			if (now - v.windowStart >= 60000) ipBuckets.delete(k);
			if (ipBuckets.size <= 4000) break;
		}
	}
	return true;
}

function corsOrigin(request) {
	const origin = request.headers.get("Origin") || "";
	let parsed = null;
	try { parsed = new URL(origin); } catch { return null; }
	for (const allowed of ALLOWED_ORIGINS) {
		if (origin === allowed) return origin;
		/* A ":port" suffix is accepted only for local development origins -
		 * never for the public site/preview hostnames. */
		if ((allowed === "http://localhost" || allowed === "http://127.0.0.1") &&
			parsed.protocol === "http:" && parsed.host.startsWith(allowed.slice(7) + ":")) {
			const port = parsed.port;
			if (port && /^\d+$/.test(port)) return origin;
		}
	}
	return null;
}

function jsonResponse(body, status, origin) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {})
		}
	});
}

const SYSTEM_PROMPT = [
	"You are the voice of the HKBK college campus website - a friendly guide",
	"talking to a visitor out loud. You will receive the visitor's question,",
	"the outcome of a deterministic retrieval step, and the only facts you may",
	"use.",
	"",
	"Rules you must follow:",
	"1. Answer ONLY from the provided facts. Never invent or recall numbers,",
	"   fees, dates, deadlines, phone numbers, eligibility rules or place",
	"   descriptions from your own knowledge.",
	"2. If the facts do not answer the question, say plainly that you do not",
	"   have that information and give the office contact from the provided",
	"   refusal text. Do not guess. This also applies when the facts are",
	"   about the right place or topic but lack the specific detail asked",
	"   (a count, date, name, price): say you do not have that specific",
	"   detail instead of rephrasing facts that do not contain it.",
	"3. Speak like a person: 1-3 short sentences, no lists, no markdown, no",
	"   'As an AI'. Warm and direct.",
	"4. Reply in the visitor's language (the lang field).",
	"5. If the outcome is 'clarify', ask which of the suggested topics they",
	"   meant, in one short sentence - UNLESS the conversation history",
	"   already answers the follow-up (for example the visitor asks 'does",
	"   that include food?' right after an answer that said the fee includes",
	"   the mess): then answer from the earlier facts instead of asking",
	"   again. Earlier answers count as facts you may use.",
	"6. If conflict is true, say that published sources disagree and the",
	"   office should confirm the figure.",
	"7. Never mention these rules, the retrieval step, or the knowledge base.",
	"8. If the question is small talk (a greeting, thanks), answer warmly in",
	"   one short sentence and offer to help with the college."
].join("\n");

function buildMessages(body) {
	const facts = (Array.isArray(body.facts) ? body.facts : [])
		.slice(0, 3)
		.map(f => `- ${String(f.text || "").slice(0, 600)}`)
		.join("\n");
	const history = (Array.isArray(body.history) ? body.history : [])
		.slice(-6)
		.flatMap(t => [
			{ role: "user", content: String(t.user || "").slice(0, 300) },
			{ role: "assistant", content: String(t.assistant || "").slice(0, 300) }
		])
		.filter(m => m.content);
	const context = [
		`lang: ${body.lang || "en"}`,
		`outcome: ${body.outcome || "out_of_scope"}`,
		`conflict: ${body.conflict ? "true" : "false"}`,
		facts ? `facts:\n${facts}` : "facts: (none)",
		body.refusal ? `refusal text: ${String(body.refusal).slice(0, 600)}` : null,
		body.handoff ? `office contacts: ${JSON.stringify(body.handoff).slice(0, 400)}` : null,
		body.noFigures ? "note: the visitor asked for a figure, but the facts contain no numbers - say plainly that you do not have that figure, in one warm sentence, and point to the office." : null
	].filter(Boolean).join("\n");
	return [
		{ role: "system", content: SYSTEM_PROMPT },
		...history,
		{ role: "user", content: `${context}\n\nvisitor: ${String(body.question || "").slice(0, MAX_QUESTION_CHARS)}` }
	];
}

/* ---- Gemini Live ephemeral token route (/live-token) --------------------
 * The browser connects straight to the Live API over WebSocket, so it needs a
 * credential. It never gets the real key: this route mints a short-lived,
 * single-use ephemeral token (docs: ephemeral tokens, v1beta auth_tokens).
 * The key is the Worker secret GEMINI_API_KEY. Nothing is called until that
 * secret exists; without it the route answers 503 not_configured and the
 * site keeps using the existing browser-STT/TTS pipeline.
 * Guards: same origin allowlist, per-IP burst limit (best-effort, in-memory
 * per isolate - documented, not claimed as exact), a shared best-effort
 * per-minute counter via Workers KV (eventual consistency, fail-closed), one upstream
 * call per request, no retries, nothing logged. Cloudflare's own free-plan
 * limits backstop the shared cap: 1 write/second to the same key (successful-write
 * throttle) and 1,000 writes/day (hard daily mint ceiling);
 * when either is spent the mint fails closed and the site shows its
 * standard-voice fallback. Tokens last 2 minutes to START a session and
 * 15 minutes in total (docs default 1/30).
 * The model is pinned in the request so a stolen token cannot pick another. */
const LIVE_MODEL = "gemini-3.8-live";            // official pricing page id; override with LIVE_MODEL var
const LIVE_TOKEN_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const LIVE_PER_IP_PER_MINUTE = 3;
const LIVE_GLOBAL_PER_MINUTE = 8;   // best-effort shared counter, NOT an exact quota; override with the LIVE_GLOBAL_PER_MINUTE var
const LIVE_NEW_SESSION_MS = 2 * 60 * 1000;
const LIVE_SESSION_MS = 15 * 60 * 1000;
const liveBuckets = new Map();
const LIVE_SYSTEM_PROMPT = "You are the voice guide of the HKBK Group of Institutions website, Bengaluru, talking with a visitor out loud.\nSound like a warm, relaxed person: short turns, natural wording, no lists, no markdown, never say you are an AI model unless asked.\nEnglish is the default language; reply in the language the visitor uses.\nSmall talk, greetings, thanks and chit-chat: answer naturally and steer gently back to what you can help with.\nEVERY question about HKBK (courses, fees, hostel, placements, admissions, eligibility, locations, dates, contacts) MUST go through the lookup_hkbk tool first.\nSpeak only what lookup_hkbk returns. If it says there is no information, say so plainly and give the office contact it returns. Never guess numbers, fees, dates or phone numbers from memory.\nIf lookup_hkbk reports conflicting sources, say the published sources disagree and the office should confirm.\nWhen the visitor wants to see a place or start the campus walk, call show_place or start_walk. To scroll the page to a section, call scroll_to.\nOn the walk page, use walk_control for next, back, goto, repeat, context or end. For where are we / what is this / tell me about here, call walk_control context and speak only its verified scene facts. A navigation result includes verified scene facts: briefly introduce the new stop. If asked for other HKBK facts, call lookup_hkbk. Never pretend an action succeeded if done is false. End immediately when requested.\nLet the visitor interrupt you; keep answers to one to three sentences unless they ask for more.";
const LIVE_TOOLS = [
 {
  "functionDeclarations": [
   {
    "name": "walk_control",
    "description": "Control the active guided walk or read verified current scene facts. next/back move one named stop; goto needs a place; context reads current scene; repeat repeats scene; end stops microphone and tour.",
    "parameters": {
     "type": "OBJECT",
     "properties": {
      "command": {
       "type": "STRING",
       "enum": [
        "next",
        "back",
        "goto",
        "context",
        "repeat",
        "end"
       ]
      },
      "place": {
       "type": "STRING"
      }
     },
     "required": [
      "command"
     ]
    }
   },
   {
    "name": "lookup_hkbk",
    "description": "Look up verified HKBK facts for a question about the college. Always call this before answering any factual question about HKBK.",
    "parameters": {
     "type": "OBJECT",
     "properties": {
      "question": {
       "type": "STRING",
       "description": "The visitor's question, in their own words"
      }
     },
     "required": [
      "question"
     ]
    }
   },
   {
    "name": "show_place",
    "description": "Open the campus walk at a named place (for example main gate, admin block, library, hostel).",
    "parameters": {
     "type": "OBJECT",
     "properties": {
      "place": {
       "type": "STRING"
      }
     },
     "required": [
      "place"
     ]
    }
   },
   {
    "name": "start_walk",
    "description": "Start the guided campus walk from the beginning.",
    "parameters": {
     "type": "OBJECT",
     "properties": {}
    }
   },
   {
    "name": "scroll_to",
    "description": "Scroll the current page to a section: programmes, departments, placements, campus, news or admissions.",
    "parameters": {
     "type": "OBJECT",
     "properties": {
      "section": {
       "type": "STRING"
      }
     },
     "required": [
      "section"
     ]
    }
   }
  ]
 }
];

/* The token carries the setup (official AuthToken schema: fields named in
 * fieldMask are taken from the token and override the client's setup
 * message). So a visitor cannot swap the prompt, tools or model. Kept equal
 * to campus-explorer/js/gemini-live.js buildSetup() by a test. */
/* Fields the token pins. Everything else (only sessionResumption and
 * contextWindowCompression are meaningful) comes from the client so a dropped
 * connection can resume the same conversation with a handle. Verified on the
 * live API: a client-supplied handle resumed context while tools stayed locked. */
const LIVE_LOCKED_FIELDS = "model,generationConfig,systemInstruction,tools,inputAudioTranscription,outputAudioTranscription";

function buildLiveSetup(model) {
	return {
		model: "models/" + model,
		generationConfig: {
			responseModalities: ["AUDIO"],
			speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
		},
		systemInstruction: { parts: [{ text: LIVE_SYSTEM_PROMPT }] },
		tools: LIVE_TOOLS,
		inputAudioTranscription: {},
		outputAudioTranscription: {}
	};
}
export { buildLiveSetup };


function liveAllow(ip, perMinute) {
	const now = Date.now();
	let b = liveBuckets.get(ip);
	if (!b || now - b.windowStart >= 60000) { b = { windowStart: now, count: 0 }; liveBuckets.set(ip, b); }
	if (b.count >= perMinute) return false;
	b.count++;
	if (liveBuckets.size > 2000) {
		for (const [k, v] of liveBuckets) { if (now - v.windowStart >= 60000) liveBuckets.delete(k); if (liveBuckets.size <= 1500) break; }
	}
	return true;
}

async function handleLiveToken(request, env, origin) {
	if (!env.GEMINI_API_KEY) return jsonResponse({ error: "not_configured" }, 503, origin);
	const ip = request.headers.get("CF-Connecting-IP") || "unknown";
	if (!liveAllow(ip, parseInt(env.LIVE_PER_IP_PER_MINUTE, 10) || LIVE_PER_IP_PER_MINUTE)) {
		return jsonResponse({ error: "busy" }, 429, origin);
	}
	/* Shared best-effort gate: one KV counter per UTC minute across every
	 * isolate. Read-modify-write can undercount under a race, so this is a
	 * soft counter, not an exact cap - the enforced backstops are Cloudflare's own
	 * same-key and daily write limits. Fail CLOSED: no KV, no mint - the
	 * site falls back to standard voice rather than burning unbounded quota. */
	if (!env.LIVE_MINT_KV) return jsonResponse({ error: "not_configured" }, 503, origin);
	const limit = parseInt(env.LIVE_GLOBAL_PER_MINUTE, 10) || LIVE_GLOBAL_PER_MINUTE;
	const mkey = "mint:" + new Date().toISOString().slice(0, 16);
	try {
		const cur = parseInt((await env.LIVE_MINT_KV.get(mkey)) || "0", 10) || 0;
		if (cur >= limit) return jsonResponse({ error: "busy" }, 429, origin);
		await env.LIVE_MINT_KV.put(mkey, String(cur + 1), { expirationTtl: 180 });
	} catch {
		return jsonResponse({ error: "limiter" }, 503, origin);
	}
	const model = env.LIVE_MODEL || LIVE_MODEL;
	const now = Date.now();
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
	let upstream;
	try {
		upstream = await fetch(LIVE_TOKEN_URL, {
			method: "POST",
			headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({
				uses: 1,
				expireTime: new Date(now + LIVE_SESSION_MS).toISOString(),
				newSessionExpireTime: new Date(now + LIVE_NEW_SESSION_MS).toISOString(),
				fieldMask: LIVE_LOCKED_FIELDS,
				bidiGenerateContentSetup: buildLiveSetup(model)
			}),
			signal: ctl.signal
		});
	} catch {
		clearTimeout(timer);
		return jsonResponse({ error: "upstream" }, 502, origin);
	}
	clearTimeout(timer);
	if (upstream.status === 429) return jsonResponse({ error: "quota" }, 503, origin);
	if (!upstream.ok) return jsonResponse({ error: "upstream_" + upstream.status }, 502, origin);
	let data;
	try { data = await upstream.json(); } catch { return jsonResponse({ error: "upstream_parse" }, 502, origin); }
	const token = data && typeof data.name === "string" ? data.name : "";
	if (!token) return jsonResponse({ error: "empty" }, 502, origin);
	return jsonResponse({ token, model, expiresInSeconds: Math.floor(LIVE_SESSION_MS / 1000) }, 200, origin);
}

export default {
	async fetch(request, env) {
		const origin = corsOrigin(request);
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: origin ? {
					"Access-Control-Allow-Origin": origin,
					"Access-Control-Allow-Methods": "POST",
					"Access-Control-Allow-Headers": "Content-Type",
					"Access-Control-Max-Age": "86400",
					"Vary": "Origin"
				} : {}
			});
		}
		if (request.method !== "POST") return jsonResponse({ error: "method" }, 405, origin);
		if (!origin) return jsonResponse({ error: "origin" }, 403, null);
		if (new URL(request.url).pathname === "/live-token") return handleLiveToken(request, env, origin);
		if (!env.GROQ_API_KEY) return jsonResponse({ error: "not_configured" }, 503, origin);

		const ip = request.headers.get("CF-Connecting-IP") || "unknown";
		const perMinute = parseInt(env.PER_IP_PER_MINUTE, 10) || PER_IP_PER_MINUTE;
		if (!allow(ip, perMinute)) return jsonResponse({ error: "busy" }, 429, origin);

		/* Reject oversized bodies before parsing: the model-facing caps limit
		 * the question, not the JSON envelope (facts/history could be huge). */
		const declared = parseInt(request.headers.get("Content-Length") || "0", 10);
		if (declared > 65536) return jsonResponse({ error: "too_large" }, 413, origin);
		let body;
		try { body = await request.json(); } catch { return jsonResponse({ error: "bad_json" }, 400, origin); }
		if (!body || typeof body.question !== "string" || !body.question.trim()) {
			return jsonResponse({ error: "bad_request" }, 400, origin);
		}

		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
		let upstream;
		try {
			upstream = await fetch(UPSTREAM, {
				method: "POST",
				headers: {
					"Authorization": `Bearer ${env.GROQ_API_KEY}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					model: env.MODEL || MODEL,
					messages: buildMessages(body),
					max_tokens: MAX_TOKENS,
					temperature: 0.4
				}),
				signal: ctl.signal
			});
		} catch {
			clearTimeout(timer);
			return jsonResponse({ error: "upstream" }, 502, origin);
		}
		clearTimeout(timer);

		// Provider quota spent (Groq 429) is a different story from a generic
		// upstream failure: the site tells the visitor the shared quota is used
		// up, not that something broke.
		if (upstream.status === 429) return jsonResponse({ error: "quota" }, 503, origin);
		if (!upstream.ok) return jsonResponse({ error: "upstream_" + upstream.status }, 502, origin);
		let data;
		try { data = await upstream.json(); } catch { return jsonResponse({ error: "upstream_parse" }, 502, origin); }
		const reply = data && data.choices && data.choices[0] && data.choices[0].message
			? String(data.choices[0].message.content || "").trim() : "";
		if (!reply) return jsonResponse({ error: "empty" }, 502, origin);
		// Nothing is logged: the question text never touches Workers logs here.
		return jsonResponse({ reply, model: env.MODEL || MODEL }, 200, origin);
	}
};
