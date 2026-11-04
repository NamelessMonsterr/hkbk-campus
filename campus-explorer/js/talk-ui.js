/*
 * talk-ui.js - "Talk to HKBK", the voice-first conversation surface.
 *
 * A bottom sheet over the homepage: big mic, live captions, small typed
 * fallback. The loop: listen -> engine retrieves -> (online proxy phrases |
 * offline KB speaks verbatim) -> speak -> listen again. A tap while the
 * assistant speaks cuts it off and listens (barge-in). Voice commands can
 * drive the site: "show me placements" scrolls the page behind the sheet,
 * "open the walk" / "take me to the food court" hands over to the guided
 * campus walk (walk/walk-guide.js).
 *
 * Facts always come from the engine. Online/offline state is shown in the
 * sheet, and the online privacy note appears once per session.
 */
(function (global) {
	"use strict";

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined && text !== null) n.textContent = String(text);
		return n;
	}

	var LANGLIB = { en: "en-IN", kn: "kn-IN", hi: "hi-IN", ur: "ur-PK" };

	function TalkUI(options) {
		this.opts = options || {};
		this.engine = new global.HKBKChat.Engine(this.opts.kb);
		this.conversation = global.HKBKTalk.createConversation({ engine: this.engine });
		this.places = global.HKBKTalkActions.buildIndex(this.opts.kb, (global.WALK && global.WALK.stops) || []);
		this.state = "closed";   // closed | idle | listening | thinking | speaking
		this.lastLang = "en";
		this._privacyNoted = false;
		this._silenceRetries = 0;
	}

	/* ---------- DOM ---------- */

	TalkUI.prototype.build = function () {
		var self = this;
		var root = el("div", "talk");
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-label", "Talk to HKBK voice assistant");
		root.setAttribute("aria-hidden", "true");

		var bar = el("div", "talk__bar");
		bar.appendChild(el("span", "talk__title", "Talk to HKBK"));
		this.modeDot = el("span", "talk__mode", this.conversation.isOnline() ? "online" : "offline");
		this.modeDot.title = this.conversation.isOnline()
			? "Online: replies are phrased by an AI service from verified facts only"
			: "Offline: answers come only from this device's knowledge base";
		bar.appendChild(this.modeDot);
		var closeB = el("button", "talk__close", "\u00D7");
		closeB.type = "button";
		closeB.setAttribute("aria-label", "End the conversation");
		closeB.addEventListener("click", function () { self.close(); });
		bar.appendChild(closeB);
		root.appendChild(bar);

		this.statusEl = el("div", "talk__status", "Tap the mic and just talk");
		root.appendChild(this.statusEl);

		this.captionEl = el("div", "talk__caption", "");
		root.appendChild(this.captionEl);

		var mid = el("div", "talk__mid");
		this.mic = el("button", "talk__mic", "\u25CF");
		this.mic.type = "button";
		this.mic.setAttribute("aria-label", "Speak");
		this.mic.addEventListener("click", function () { self._micTap(); });
		mid.appendChild(this.mic);
		root.appendChild(mid);

		var form = el("form", "talk__form");
		this.input = el("input", "talk__input");
		this.input.type = "text";
		this.input.placeholder = "or type here\u2026";
		this.input.autocomplete = "off";
		this.input.setAttribute("aria-label", "Type your message");
		var send = el("button", "talk__send", "Send");
		send.type = "submit";
		form.appendChild(this.input);
		form.appendChild(send);
		form.addEventListener("submit", function (e) {
			e.preventDefault();
			var q = self.input.value.trim();
			if (!q) return;
			self.input.value = "";
			self._hear(q);
		});
		root.appendChild(form);

		this.noteEl = el("div", "talk__note", "");
		root.appendChild(this.noteEl);

		document.body.appendChild(root);
		this.root = root;
	};

	/* ---------- state ---------- */

	TalkUI.prototype._setState = function (s, statusText) {
		this.state = s;
		this.root.classList.toggle("talk--listening", s === "listening");
		this.root.classList.toggle("talk--speaking", s === "speaking");
		this.root.classList.toggle("talk--thinking", s === "thinking");
		if (statusText) this.statusEl.textContent = statusText;
	};

	TalkUI.prototype._caption = function (who, text) {
		this.captionEl.innerHTML = "";
		var line = el("div", "talk__line talk__line--" + who);
		line.appendChild(el("b", null, who === "you" ? "You" : "Guide"));
		line.appendChild(el("span", null, text));
		this.captionEl.appendChild(line);
	};

	TalkUI.prototype._note = function (text) {
		this.noteEl.textContent = text || "";
	};

	/* ---------- open/close ---------- */

	TalkUI.prototype.open = function () {
		if (this.state !== "closed") return;
		document.body.classList.add("talk-open");
		this.root.setAttribute("aria-hidden", "false");
		this.root.classList.add("talk--open");
		this._setState("idle", "One moment\u2026");
		var self = this;
		var greet = "Hi! I'm the HKBK guide. Ask me about the college, or just say: walk me through the campus.";
		if (this.conversation.isOnline() && !this._privacyNoted) {
			this._privacyNoted = true;
			this._note("Online mode: your question text is sent to an AI service for phrasing. The facts come only from the verified knowledge base, and nothing is stored there. Voice typing uses your browser's speech recognition, which may send the audio to your browser provider.");
		} else if (!this.conversation.isOnline()) {
			this._note("Offline mode: answers come only from the knowledge base on this device - no question text is sent to any AI service. Voice typing uses your browser's speech recognition, which may send the audio to your browser provider.");
		}
		this._speak(greet, "en", function () { self._listen(); });
	};

	TalkUI.prototype.close = function () {
		document.body.classList.remove("talk-open");
		this._stopRec();
		if (global.HKBKVoice) global.HKBKVoice.cancel();
		this.conversation.clear();          // session memory dies with the session
		this.root.classList.remove("talk--open");
		this.root.setAttribute("aria-hidden", "true");
		this._setState("closed");
		this._caption("you", "");
		this.captionEl.innerHTML = "";
		if (this.opts.onClose) this.opts.onClose();
	};

	/* ---------- speech ---------- */

	TalkUI.prototype._speak = function (text, lang, then) {
		var self = this;
		this._setState("speaking", "Speaking\u2026 tap the mic to interrupt");
		this._caption("guide", text);
		if (!global.HKBKVoice) { if (then) then(); return; }
		global.HKBKVoice.speak(text, lang || this.lastLang || "en", {
			onend: function () { if (then) then(); }
		});
	};

	TalkUI.prototype._listen = function () {
		var self = this;
		var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
		if (!SR) {
			this._setState("idle", "This browser has no speech recognition - typing below works the same.");
			return;
		}
		if (global.HKBKVoice) global.HKBKVoice.cancel();
		var rec = new SR();
		this._rec = rec;
		rec.lang = LANGLIB[this.lastLang] || "en-IN";
		rec.interimResults = true;
		rec.continuous = false;
		this._setState("listening", "Listening\u2026");
		rec.onresult = function (ev) {
			var txt = "";
			for (var i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
			self._caption("you", txt);
			if (ev.results[ev.results.length - 1].isFinal) {
				var q = txt.trim();
				try { rec.stop(); } catch (e) {}
				if (q) self._hear(q);
			}
		};
		rec.onend = function () {
			if (self.state === "listening") self._setState("idle", "Tap the mic and just talk");
		};
		rec.onerror = function (ev) {
			if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) {
				self._setState("idle", "Microphone permission was denied - typing below works the same.");
				return;
			}
			if (ev && ev.error === "no-speech" && self.state === "listening") {
				self._silenceRetries++;
				if (self._silenceRetries < 2) {
					setTimeout(function () { if (self.state !== "closed") self._listen(); }, 400);
				} else {
					self._setState("idle", "I didn't hear anything - tap the mic when you're ready");
				}
			}
		};
		try { rec.start(); } catch (e) { self._setState("idle", "Tap the mic and just talk"); }
	};

	TalkUI.prototype._stopRec = function () {
		if (this._rec) { try { this._rec.stop(); } catch (e) {} this._rec = null; }
	};

	/* Mic tap = start listening, or barge-in while the guide speaks. */
	TalkUI.prototype._micTap = function () {
		if (this.state === "listening") { this._stopRec(); this._setState("idle", "Tap the mic and just talk"); return; }
		if (this.state === "speaking" && global.HKBKVoice) global.HKBKVoice.cancel();  // barge-in
		this._listen();
	};

	/* ---------- one turn ---------- */

	TalkUI.prototype._hear = function (text) {
		var self = this;
		this._silenceRetries = 0;
		this._caption("you", text);

		/* Site-control commands first: they act, then keep listening. */
		var action = global.HKBKTalkActions.parse(text, { places: this.places });
		if (action) { this._act(action, text); return; }

		this._setState("thinking", "Thinking\u2026");
		this.conversation.reply(text).then(function (r) {
			if (r.engine && r.engine.lang) self.lastLang = r.engine.lang;
			if (global.HKBKUsage && global.HKBKUsage.enabled() && r.engine && r.engine.type !== "smalltalk") {
				global.HKBKUsage.log(r.engine.type === "answer" ? "answer" : (r.engine.type === "clarify" ? "clarify" : "refusal"), {
					entryId: r.engine.entryId || null,
					category: r.engine.category || null,
					confidenceBand: global.HKBKUsage.band(r.engine.confidence),
					via: "talk-" + r.mode
				});
			}
			var extra = "";
			/* The answer mentions a place with footage: offer the walk, don't force it. */
			if (r.engine && r.engine.walkStop && r.engine.type === "answer") {
				extra = " Say 'show me' and I'll open the walk right there.";
			}
			self._speak(r.text + extra, r.engine.lang, function () { self._listen(); });
		}, function () {
			self._speak("Something broke on my side. Try that again?", "en", function () { self._listen(); });
		});
	};

	TalkUI.prototype._act = function (action, said) {
		var self = this;
		var base = (this.opts.walkBase) || "walk/";
		if (action.type === "start_walk" || action.type === "show_place") {
			var stop = action.stopId || "gate";
			this._speak(
				action.type === "start_walk"
					? "Opening the campus walk. I'll guide you through it - say next to move on, or ask me anything on the way."
					: "Taking you there on the campus walk.",
				this.lastLang,
				function () { global.location.href = base + "index.html?guide=1&stop=" + encodeURIComponent(stop); }
			);
			return;
		}
		if (action.type === "scroll") {
			var t = document.getElementById(action.anchor);
			if (t) {
				t.scrollIntoView({ behavior: "smooth", block: "start" });
				this._speak("Here you go - that's on the page behind me.", this.lastLang, function () { self._listen(); });
			} else {
				this._speak("That section isn't on this page. Ask me and I'll tell you instead.", this.lastLang, function () { self._listen(); });
			}
			return;
		}
		this._listen();
	};

	global.HKBKTalkUI = { TalkUI: TalkUI };
})(typeof window !== "undefined" ? window : globalThis);
