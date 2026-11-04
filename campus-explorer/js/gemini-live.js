/*
 * gemini-live.js - full-duplex voice conversation over the Gemini Live API.
 *
 * The page asks the HKBK proxy (Cloudflare Worker /live-token) for a
 * single-use ephemeral token, then talks to Google directly over WebSocket.
 * The real API key never reaches the page. Audio flows both ways at once, so
 * the visitor can interrupt and the model stops mid-sentence.
 *
 * Grounding: the model has no facts of its own to offer. For any question
 * about the college it must call lookup_hkbk, which runs the site's existing
 * deterministic knowledge-base engine and returns only retrieved facts (or an
 * explicit "no information" result). Site actions (show_place, start_walk,
 * scroll_to) are tool calls handled by the page.
 *
 * Pure helpers (message builders, PCM conversion, tool dispatch) are exported
 * for Node tests; browser audio/WebSocket wiring is in LiveSession.
 */
(function (global) {
	"use strict";

	var MODEL = "gemini-3.8-live";
	var WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
	var IN_RATE = 16000;
	var OUT_RATE = 24000;

	var SYSTEM_PROMPT = [
		"You are the voice guide of the HKBK Group of Institutions website, Bengaluru, talking with a visitor out loud.",
		"Sound like a warm, relaxed person: short turns, natural wording, no lists, no markdown, never say you are an AI model unless asked.",
		"English is the default language; reply in the language the visitor uses.",
		"Small talk, greetings, thanks and chit-chat: answer naturally and steer gently back to what you can help with.",
		"EVERY question about HKBK (courses, fees, hostel, placements, admissions, eligibility, locations, dates, contacts) MUST go through the lookup_hkbk tool first.",
		"Speak only what lookup_hkbk returns. If it says there is no information, say so plainly and give the office contact it returns. Never guess numbers, fees, dates or phone numbers from memory.",
		"If lookup_hkbk reports conflicting sources, say the published sources disagree and the office should confirm.",
		"When the visitor wants to see a place or start the campus walk, call show_place or start_walk. To scroll the page to a section, call scroll_to.",
		"Let the visitor interrupt you; keep answers to one to three sentences unless they ask for more."
	].join("\n");

	var TOOLS = [{
		functionDeclarations: [
			{
				name: "lookup_hkbk",
				description: "Look up verified HKBK facts for a question about the college. Always call this before answering any factual question about HKBK.",
				parameters: { type: "OBJECT", properties: { question: { type: "STRING", description: "The visitor's question, in their own words" } }, required: ["question"] }
			},
			{
				name: "show_place",
				description: "Open the campus walk at a named place (for example main gate, admin block, library, hostel).",
				parameters: { type: "OBJECT", properties: { place: { type: "STRING" } }, required: ["place"] }
			},
			{
				name: "start_walk",
				description: "Start the guided campus walk from the beginning.",
				parameters: { type: "OBJECT", properties: {} }
			},
			{
				name: "scroll_to",
				description: "Scroll the current page to a section: programmes, departments, placements, campus, news or admissions.",
				parameters: { type: "OBJECT", properties: { section: { type: "STRING" } }, required: ["section"] }
			}
		]
	}];

	/* ---------- pure helpers ---------- */

	function buildSetup(opts) {
		opts = opts || {};
		return {
			setup: {
				model: "models/" + (opts.model || MODEL),
				generationConfig: {
					responseModalities: ["AUDIO"],
					speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || "Aoede" } } }
				},
				systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
				tools: TOOLS,
				inputAudioTranscription: {},
				outputAudioTranscription: {}
			}
		};
	}

	function floatToPcm16(f32) {
		var out = new Int16Array(f32.length);
		for (var i = 0; i < f32.length; i++) {
			var s = Math.max(-1, Math.min(1, f32[i]));
			out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
		}
		return out;
	}

	function pcm16ToFloat(i16) {
		var out = new Float32Array(i16.length);
		for (var i = 0; i < i16.length; i++) out[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7fff);
		return out;
	}

	/* Linear downsample from the device rate to 16 kHz. */
	function downsample(f32, fromRate, toRate) {
		if (fromRate === toRate) return f32;
		var ratio = fromRate / toRate;
		var n = Math.floor(f32.length / ratio);
		var out = new Float32Array(n);
		for (var i = 0; i < n; i++) {
			var pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, f32.length - 1), t = pos - i0;
			out[i] = f32[i0] * (1 - t) + f32[i1] * t;
		}
		return out;
	}

	function b64FromBytes(bytes) {
		var s = "";
		for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"));
	}
	function bytesFromB64(b64) {
		var s = (typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary"));
		var out = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	function audioMessage(i16) {
		return { realtimeInput: { audio: { data: b64FromBytes(new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength)), mimeType: "audio/pcm;rate=" + IN_RATE } } };
	}

	function toolResponseMessage(id, name, response) {
		return { toolResponse: { functionResponses: [{ id: id, name: name, response: response }] } };
	}

	/* Tool dispatch. deps: { lookup(question)->{...}, act(action) } */
	function runTool(call, deps) {
		var args = (call && call.args) || {};
		try {
			if (call.name === "lookup_hkbk") {
				var r = deps.lookup(String(args.question || ""));
				return { output: r };
			}
			if (call.name === "show_place") {
				var ok = deps.act({ type: "show_place", place: String(args.place || "") });
				return { output: ok ? { done: true } : { done: false, note: "I could not find that place on the walk." } };
			}
			if (call.name === "start_walk") { deps.act({ type: "start_walk" }); return { output: { done: true } }; }
			if (call.name === "scroll_to") {
				var s = deps.act({ type: "scroll", section: String(args.section || "") });
				return { output: s ? { done: true } : { done: false, note: "That section is not on this page." } };
			}
		} catch (e) {
			return { output: { error: "tool_failed" } };
		}
		return { output: { error: "unknown_tool" } };
	}

	/* Turn one engine result into a model-safe tool payload. Only retrieved
	 * facts, the engine's own conflict note and the office contact travel. */
	function lookupPayload(res) {
		if (!res) return { found: false, note: "No information available. Say you do not have it and point to the admissions office." };
		if (res.type === "answer") {
			var out = { found: true, facts: [String(res.answer || "")], conflict: !!res.conflict };
			if (res.conflict && res.conflict.text) out.conflict_note = String(res.conflict.text);
			if (res.hedged) out.note = "Low confidence: if the facts do not clearly answer the question, say you are not sure and point to the office.";
			if (res.walkStop) out.walk_available = true;
			return out;
		}
		if (res.type === "clarify") {
			var sugg = (res.suggestions || []).map(function (x) { return x && (x.question || x.entryId); }).filter(Boolean);
			return { found: false, clarify: true, suggestions: sugg, note: "Ask in one short sentence which of these they mean." };
		}
		return {
			found: false,
			note: "No verified information. Tell the visitor you do not have that and give the office contact.",
			refusal_wording: String(res.answer || ""),
			contacts: res.handoff || null
		};
	}

	/* Handle one parsed server message. Returns events for the UI. */
	function interpretServerMessage(msg) {
		var ev = [];
		if (!msg) return ev;
		if (msg.setupComplete) ev.push({ type: "ready" });
		var sc = msg.serverContent;
		if (sc) {
			if (sc.interrupted) ev.push({ type: "interrupted" });
			if (sc.modelTurn && sc.modelTurn.parts) {
				sc.modelTurn.parts.forEach(function (p) {
					if (p.inlineData && /^audio\/pcm/.test(p.inlineData.mimeType || "")) ev.push({ type: "audio", bytes: bytesFromB64(p.inlineData.data) });
				});
			}
			if (sc.inputTranscription && sc.inputTranscription.text) ev.push({ type: "user_text", text: sc.inputTranscription.text });
			if (sc.outputTranscription && sc.outputTranscription.text) ev.push({ type: "model_text", text: sc.outputTranscription.text });
			if (sc.turnComplete) ev.push({ type: "turn_complete" });
		}
		if (msg.toolCall && msg.toolCall.functionCalls) {
			msg.toolCall.functionCalls.forEach(function (c) { ev.push({ type: "tool_call", call: c }); });
		}
		if (msg.goAway) ev.push({ type: "go_away" });
		return ev;
	}

	/* ---------- browser session ---------- */

	function LiveSession(options) {
		this.opts = options || {};
		this.ws = null;
		this.ctx = null;
		this.stream = null;
		this.nextPlayAt = 0;
		this.sources = [];
		this.ready = false;
		this.closed = false;
	}

	LiveSession.prototype._emit = function (type, data) {
		if (this.opts.onEvent) this.opts.onEvent(type, data || {});
	};

	/* Mint a token, then open one WebSocket. handle (optional) resumes the
	 * earlier conversation. Resolves once the server says setupComplete. */
	LiveSession.prototype._connect = function (handle) {
		var self = this;
		var endpoint = (this.opts.endpoint || "").replace(/\/$/, "");
		return fetch(endpoint + "/live-token", { method: "POST" }).then(function (res) {
			if (!res.ok) { var e = new Error("token_" + res.status); e.status = res.status; throw e; }
			return res.json();
		}).then(function (t) {
			if (self.closed) throw new Error("session_closed");
			if (!t || !t.token) throw new Error("token_empty");
			return new Promise(function (resolve, reject) {
				var ws = new WebSocket(WS_BASE + "?access_token=" + encodeURIComponent(t.token));
				self.ws = ws;
				var settled = false;
				ws.onopen = function () {
					var setup = buildSetup({ model: t.model });
					/* Pinned fields are overridden by the token; these two are the client's. */
					setup.setup.sessionResumption = handle ? { handle: handle } : {};
					setup.setup.contextWindowCompression = { slidingWindow: {} };
					ws.send(JSON.stringify(setup));
				};
				ws.onmessage = function (e) {
					if (ws !== self.ws) return;
					var go = function (text) {
						var msg; try { msg = JSON.parse(text); } catch (x) { return; }
						if (msg.sessionResumptionUpdate && msg.sessionResumptionUpdate.newHandle) self.handle = msg.sessionResumptionUpdate.newHandle;
						interpretServerMessage(msg).forEach(function (ev) {
							if (ev.type === "ready") { if (!settled) { settled = true; resolve(); } return; }
							self._handle(ev);
						});
					};
					if (typeof e.data === "string") go(e.data);
					else if (e.data && e.data.text) e.data.text().then(go);
				};
				ws.onerror = function () { if (!settled) { settled = true; reject(new Error("ws_error")); } };
				ws.onclose = function (e) {
					if (ws !== self.ws) return;
					self.ready = false;
					if (!settled) { settled = true; reject(new Error("ws_closed_" + (e && e.code))); return; }
					if (!self.closed) self._recover("closed");
				};
			});
		});
	};

	LiveSession.prototype.start = function () {
		var self = this;
		if (!(this.opts.endpoint || "")) return Promise.reject(new Error("no_endpoint"));
		var AC = global.AudioContext || global.webkitAudioContext;
		return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
			if (self.closed) { stream.getTracks().forEach(function (t) { t.stop(); }); throw new Error("session_closed"); }
			self.stream = stream;
			self.ctx = new AC();
			return self._connect(null);
		}).then(function () {
			if (self.closed) { self.stop(); throw new Error("session_closed"); }
			self._startMic();
			self.ready = true;
			self._emit("ready");
		}, function (err) { self.stop(); throw err; });
	};

	/* The connection dropped or Google asked for a reconnect (about every ten
	 * minutes). Resume the same conversation with the last handle. Bounded:
	 * at most three tries per drop, then the UI is told so it can say so. */
	LiveSession.prototype._recover = function (why) {
		var self = this;
		if (this.closed || this._recovering) return;
		this._recovering = true; this.ready = false;
		this._emit("reconnecting", { why: why });
		var tries = 0;
		(function attempt() {
			if (self.closed) { self._recovering = false; return; }
			tries++;
			var old = self.ws;
			self._connect(self.handle).then(function () {
				if (self.closed) { self.stop(); self._recovering = false; return; }
				if (old && old !== self.ws) { try { old.close(); } catch (e) { /* already closed */ } }
				self._recovering = false; self.ready = true; self._emit("ready");
			}, function () {
				if (tries < 3) global.setTimeout(attempt, 600 * tries);
				else { self._recovering = false; self._emit("closed", { code: "reconnect_failed" }); }
			});
		})();
	};

	LiveSession.prototype._startMic = function () {
		var self = this;
		var src = this.ctx.createMediaStreamSource(this.stream);
		var proc = this.ctx.createScriptProcessor(4096, 1, 1);
		var mute = this.ctx.createGain(); mute.gain.value = 0;
		proc.onaudioprocess = function (e) {
			if (self.closed || !self.ready || !self.ws || self.ws.readyState !== 1) return;
			var f = downsample(e.inputBuffer.getChannelData(0), self.ctx.sampleRate, IN_RATE);
			self.ws.send(JSON.stringify(audioMessage(floatToPcm16(f))));
		};
		src.connect(proc); proc.connect(mute); mute.connect(this.ctx.destination);
		this._mic = { src: src, proc: proc, mute: mute };
	};

	LiveSession.prototype._handle = function (ev) {
		var self = this;
		if (ev.type === "audio") { this.toolPending = false; this._play(ev.bytes); this._emit("speaking"); return; }
		/* The turn that ends with a tool call is not the end of the answer. */
		if (ev.type === "turn_complete" && this.toolPending) return;
		if (ev.type === "interrupted") { this._flush(); this._emit("interrupted"); return; }
		if (ev.type === "tool_call") {
			this.toolPending = true;
			var res = runTool(ev.call, this.opts.tools || {});
			if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(toolResponseMessage(ev.call.id, ev.call.name, res.output)));
			this._emit("tool", { name: ev.call.name, args: ev.call.args, result: res.output });
			return;
		}
		if (ev.type === "go_away") { this._recover("go_away"); return; }
		this._emit(ev.type, ev);
	};

	LiveSession.prototype._play = function (bytes) {
		if (!this.ctx || bytes.length < 2) return;
		var i16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
		var f = pcm16ToFloat(i16);
		var buf = this.ctx.createBuffer(1, f.length, OUT_RATE);
		buf.copyToChannel(f, 0);
		var src = this.ctx.createBufferSource();
		src.buffer = buf; src.connect(this.ctx.destination);
		var t = Math.max(this.ctx.currentTime + 0.02, this.nextPlayAt);
		src.start(t);
		this.nextPlayAt = t + buf.duration;
		var self = this;
		this.sources.push(src);
		src.onended = function () { self.sources = self.sources.filter(function (s) { return s !== src; }); if (!self.sources.length) self._emit("idle"); };
	};

	LiveSession.prototype._flush = function () {
		this.sources.forEach(function (s) { try { s.stop(); } catch (e) { /* already ended */ } });
		this.sources = [];
		this.nextPlayAt = 0;
	};

	LiveSession.prototype.sendText = function (text) {
		if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { text: String(text) } }));
	};

	LiveSession.prototype.stop = function () {
		this.closed = true; this.ready = false;
		this._flush();
		if (this._mic) { try { this._mic.proc.onaudioprocess = null; this._mic.proc.disconnect(); this._mic.src.disconnect(); this._mic.mute.disconnect(); } catch (e) { /* ignore */ } this._mic = null; }
		if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); this.stream = null; }
		if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } this.ws = null; }
		if (this.ctx) { try { this.ctx.close(); } catch (e) { /* ignore */ } this.ctx = null; }
	};

	var api = {
		MODEL: MODEL, SYSTEM_PROMPT: SYSTEM_PROMPT, TOOLS: TOOLS, LiveSession: LiveSession,
		buildSetup: buildSetup, audioMessage: audioMessage, toolResponseMessage: toolResponseMessage,
		runTool: runTool, lookupPayload: lookupPayload, interpretServerMessage: interpretServerMessage,
		floatToPcm16: floatToPcm16, pcm16ToFloat: pcm16ToFloat, downsample: downsample,
		b64FromBytes: b64FromBytes, bytesFromB64: bytesFromB64
	};
	global.HKBKGeminiLive = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
