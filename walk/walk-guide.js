/*
 * walk-guide.js - the talking campus guide for the walk page.
 *
 * Starts from walk/index.html?guide=1 (what Talk to HKBK opens when a
 * visitor says "open the walk") or from the Guide button. The guide
 * introduces each stop out loud as you reach it, moves on "next", goes back
 * on "back", jumps to a place on "take me to X", answers questions from the
 * same conversation layer as the homepage (facts from the KB; online
 * phrasing only when the proxy is configured), and ends on "end tour".
 * Every command also works with the on-screen controls; the mic needs a
 * browser with speech recognition, typing always works.
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

	/* What the guide says at a stop: its name, then the KB's verified line
	 * about the place when one exists, else the walk's own description. */
	function buildNarration(stop, kbEntry) {
		if (!stop) return "";
		var fact = (kbEntry && kbEntry.en && kbEntry.en.a) ? kbEntry.en.a : (stop.desc || "");
		return stop.name + ". " + fact;
	}

	function WalkGuide(options) {
		this.opts = options || {};
		this.ctl = this.opts.ctl;                    // __walkCtl from the page
		this.kb = this.opts.kb;
		this.stops = (global.WALK && global.WALK.stops) || [];
		this.engine = new global.HKBKChat.Engine(this.kb);
		this.conversation = global.HKBKTalk.createConversation({ engine: this.engine });
		this.places = global.HKBKTalkActions.buildIndex(this.kb, this.stops);
		this.active = false;
		this.paused = false;
		this.lastChapter = null;
		this.lastNarration = "";
		this.lastLang = "en";
	}

	WalkGuide.prototype.entryFor = function (stopId) {
		var entries = (this.kb && this.kb.entries) || [];
		for (var i = 0; i < entries.length; i++) {
			if (entries[i].walkStop === stopId) return entries[i];
		}
		return null;
	};

	WalkGuide.prototype.stopById = function (id) {
		for (var i = 0; i < this.stops.length; i++) if (this.stops[i].id === id) return this.stops[i];
		return null;
	};

	/* ---------- panel ---------- */

	WalkGuide.prototype.build = function () {
		var self = this;
		var panel = el("div", "guide");
		panel.setAttribute("role", "status");
		this.statusEl = el("div", "guide__status", "Guide");
		this.captionEl = el("div", "guide__caption", "");
		var row = el("div", "guide__row");
		this.mic = el("button", "guide__mic", "\u25CF");
		this.mic.type = "button";
		this.mic.setAttribute("aria-label", "Speak to the guide");
		this.mic.addEventListener("click", function () {
			if (self._listening) { self._stopRec(); return; }
			if (global.HKBKVoice) global.HKBKVoice.cancel();   // barge-in
			if (self.paused) {                                 // tap resumes a paused tour
				self.paused = false;
				self._status("Guiding");
				self._speak("Continuing the tour.", function () { self._listen(); });
				return;
			}
			self._listen();
		});
		this.input = el("input", "guide__input");
		this.input.type = "text";
		this.input.placeholder = "next / take me to X / ask a question\u2026";
		this.input.setAttribute("aria-label", "Type a command or question");
		this.input.addEventListener("keydown", function (e) {
			if (e.key === "Enter") {
				var q = self.input.value.trim();
				if (q) { self.input.value = ""; self._hear(q); }
			}
		});
		var endB = el("button", "guide__end", "End tour");
		endB.type = "button";
		endB.addEventListener("click", function () { self.end(); });
		row.appendChild(this.mic); row.appendChild(this.input); row.appendChild(endB);
		panel.appendChild(this.statusEl); panel.appendChild(this.captionEl); panel.appendChild(row);
		document.body.appendChild(panel);
		this.panel = panel;
	};

	WalkGuide.prototype._caption = function (text) { this.captionEl.textContent = text || ""; };
	WalkGuide.prototype._status = function (text) { this.statusEl.textContent = text; };

	/* ---------- tour flow ---------- */

	WalkGuide.prototype.start = function () {
		if (this.active) return;
		this.active = true;
		this.paused = false;
		this.panel.classList.add("on");
		var self = this;
		var intro = "Starting the campus walk. I'll explain each stop as we reach it. " +
			"Say next to move on, back to return, take me to a place to jump there, or end tour to finish.";
		this._status("Guiding");
		this._speak(intro, function () { self._narrateCurrent(true); });
	};

	WalkGuide.prototype.end = function () {
		this.active = false;
		this._stopRec();
		if (global.HKBKVoice) global.HKBKVoice.cancel();
		this.conversation.clear();
		this.panel.classList.remove("on");
		this._status("Guide");
	};

	WalkGuide.prototype._currentStop = function () {
		var id = this.ctl.chapterId ? this.ctl.chapterId() : this.ctl.chapter();
		return id ? this.stopById(id) : null;
	};

	WalkGuide.prototype._narrateCurrent = function (then) {
		this._narrateStop(this._currentStop(), then);
	};

	/* Narrate a specific stop. Used for jumps and next/back, because the
	 * walk animates to the new step and the chapter read-back lags. */
	WalkGuide.prototype._narrateStop = function (stop, then) {
		var self = this;
		var text = buildNarration(stop, stop && this.entryFor(stop.id));
		this.lastNarration = text;
		this.lastChapter = stop ? stop.id : null;
		this._speak(text, function () { if (then !== false) self._listen(); });
	};

	/* The stop after/before the current one in the tour order. */
	WalkGuide.prototype._adjacentStop = function (delta) {
		var cur = this._currentStop();
		var idx = -1;
		for (var i = 0; i < this.stops.length; i++) if (cur && this.stops[i].id === cur.id) { idx = i; break; }
		if (idx === -1) idx = delta > 0 ? -1 : this.stops.length;   // unknown position: start from an end
		var t = idx + delta;
		return (t >= 0 && t < this.stops.length) ? this.stops[t] : null;
	};

	WalkGuide.prototype._speak = function (text, then) {
		this._caption(text);
		if (!global.HKBKVoice) { if (then) then(); return; }
		global.HKBKVoice.speak(text, this.lastLang || "en", { onend: function () { if (then) then(); } });
	};

	WalkGuide.prototype._listen = function () {
		var self = this;
		if (!this.active || this.paused) return;
		var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
		if (!SR) { this._status("Type below - this browser has no speech recognition"); return; }
		var rec = new SR();
		this._rec = rec;
		this._listening = true;
		this.mic.classList.add("on");
		this._status("Listening - next / back / take me to X / ask me");
		rec.lang = LANGLIB[this.lastLang] || "en-IN";
		rec.interimResults = false;
		rec.continuous = false;
		rec.onresult = function (ev) {
			var q = ev.results[ev.results.length - 1][0].transcript.trim();
			self._stopRec();
			if (q) self._hear(q);
		};
		rec.onend = function () { self._listening = false; self.mic.classList.remove("on"); };
		rec.onerror = function (ev) {
			self._listening = false; self.mic.classList.remove("on");
			if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed")) {
				self._status("Mic blocked - type below");
			}
		};
		try { rec.start(); } catch (e) { self._listening = false; self.mic.classList.remove("on"); }
	};

	WalkGuide.prototype._stopRec = function () {
		if (this._rec) { try { this._rec.stop(); } catch (e) {} this._rec = null; }
		this._listening = false;
		if (this.mic) this.mic.classList.remove("on");
	};

	/* ---------- one turn ---------- */

	WalkGuide.prototype._hear = function (text) {
		var self = this;
		var action = global.HKBKTalkActions.parse(text, { places: this.places, guiding: true });

		if (action && action.type === "guide_end") { this._speak("Ending the tour. Enjoy the campus!", function () { self.end(); }); return; }
		if (action && action.type === "guide_pause") {
			this.paused = true;
			this._speak("Paused. Tap the mic when you want to continue.");
			this._status("Paused");
			return;
		}
		if (action && action.type === "guide_repeat") { this._speak(this.lastNarration || "Nothing to repeat yet.", function () { self._listen(); }); return; }
		if (action && action.type === "guide_next" || action && action.type === "guide_prev") {
			/* next/back mean the next NAMED STOP, not one frame of the walk. */
			var target = this._adjacentStop(action.type === "guide_next" ? 1 : -1);
			if (!target) {
				this._speak(action.type === "guide_next"
					? "That was the last stop. Say back to return, or end tour to finish."
					: "We are at the first stop. Say next to begin the walk.", function () { self._listen(); });
				return;
			}
			this.ctl.gotoStop(target.id);
			this._narrateStop(target);
			return;
		}
		if (action && action.type === "guide_goto") {
			var jumped = this.stopById(action.stopId);
			this.ctl.gotoStop(action.stopId);
			if (jumped) this._narrateStop(jumped); else this._narrateCurrent();
			return;
		}

		/* A real question: answer from the conversation layer, keep guiding. */
		this._status("Thinking\u2026");
		this.conversation.reply(text).then(function (r) {
			if (r.engine && r.engine.lang) self.lastLang = r.engine.lang;
			self._status("Guiding");
			self._speak(r.text, function () { self._listen(); });
		}, function () {
			self._speak("Something broke on my side. Try that again?", function () { self._listen(); });
		});
	};

	/* Mic tap while paused resumes the tour. */

	global.HKBKWalkGuide = { WalkGuide: WalkGuide, buildNarration: buildNarration };
	if (typeof module !== "undefined" && module.exports) module.exports = global.HKBKWalkGuide;
})(typeof window !== "undefined" ? window : globalThis);
