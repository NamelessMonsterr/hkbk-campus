/*
 * HKBK chatbot - user interface layer.
 *
 * Deliberately dumb: this file renders and nothing else. Every decision about
 * what to say lives in chatbot-engine.js, and every fact lives in
 * knowledge-base.json. No dependencies, no build step, no network calls.
 */
"use strict";

(function (global) {
	var ENGINE_API = global.HKBKChat;

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined && text !== null) n.textContent = String(text);
		return n;
	}

	/* "highestPackage" -> "Highest package" */
	function labelise(key) {
		var s = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	function ChatUI(options) {
		this.opts = options || {};
		this.mount = this.opts.mount;
		this.engine = null;
		this.debug = false;
		this.busy = false;
		this.lastTrace = null;
	}

	/* ---------- boot ---------- */

	ChatUI.prototype.init = function (kb) {
		this.engine = new ENGINE_API.Engine(kb);
		this.build();
		this.greet();
		return this;
	};

	ChatUI.prototype.build = function () {
		var self = this;
		var root = el("div", "chat");

		/* header */
		var head = el("div", "chat__head");
		head.appendChild(el("span", "chat__title", "Ask HKBK"));
		var sub = el("span", "chat__sub", "Answers come from a fixed knowledge base");
		head.appendChild(sub);

		var dbg = el("button", "chat__dbg", "trace");
		dbg.type = "button";
		dbg.setAttribute("aria-pressed", "false");
		dbg.title = "Show how the answer was retrieved";
		dbg.addEventListener("click", function () {
			self.debug = !self.debug;
			dbg.setAttribute("aria-pressed", String(self.debug));
			root.classList.toggle("chat--debug", self.debug);
			if (self.debug && self.lastTrace) self.renderTrace(self.lastTrace);
		});
		head.appendChild(dbg);

		var close = el("button", "chat__close", "\u00D7");
		close.type = "button";
		close.setAttribute("aria-label", "Close chat and end session");
		close.addEventListener("click", function () { self.close(); });
		head.appendChild(close);
		root.appendChild(head);

		/* transcript */
		this.log = el("div", "chat__log");
		this.log.setAttribute("role", "log");
		this.log.setAttribute("aria-live", "polite");
		root.appendChild(this.log);

		/* quick replies */
		this.chips = el("div", "chat__chips");
		root.appendChild(this.chips);

		/* composer */
		var form = el("form", "chat__form");
		this.input = el("input", "chat__input");
		this.input.type = "text";
		this.input.placeholder = "Fees, hostel, admission, placements\u2026";
		this.input.autocomplete = "off";
		this.input.setAttribute("aria-label", "Type your question");
		var send = el("button", "chat__send", "Ask");
		send.type = "submit";
		form.appendChild(this.input);
		form.appendChild(send);
		form.addEventListener("submit", function (e) {
			e.preventDefault();
			var q = self.input.value.trim();
			if (!q || self.busy) return;
			self.input.value = "";
			self.submit(q);
		});
		root.appendChild(form);

		/* trace pane, hidden unless debug is on */
		this.trace = el("pre", "chat__trace");
		root.appendChild(this.trace);

		this.mount.appendChild(root);
		this.root = root;
		this.renderChips();
	};

	ChatUI.prototype.greet = function () {
		this.addBot(
			"Hello. Ask me about admission, fees, hostel, placements or the campus. " +
			"If I am not confident, I will say so and give you the office number " +
			"instead of guessing."
		);
	};

	/* ---------- rendering ---------- */

	ChatUI.prototype.addUser = function (text) {
		var row = el("div", "msg msg--user");
		row.appendChild(el("div", "msg__body", text));
		this.log.appendChild(row);
		this.scroll();
	};

	ChatUI.prototype.addBot = function (text, kind) {
		var row = el("div", "msg msg--bot" + (kind ? " msg--" + kind : ""));
		row.appendChild(el("div", "msg__body", text));
		this.log.appendChild(row);
		this.scroll();
		return row;
	};

	ChatUI.prototype.addNote = function (row, label, text) {
		var n = el("div", "msg__note");
		n.appendChild(el("span", "msg__noteLabel", label));
		n.appendChild(el("span", "msg__noteText", text));
		row.appendChild(n);
		this.scroll();
		return n;
	};

	/* Contested figures are shown as every published value, never as one
	 * confident number. Payload shape comes from Engine.conflictNote:
	 * { text: string, fields: [ { field: string, values: [string] } ] } */
	ChatUI.prototype.addConflicts = function (row, conflict) {
		var fields = conflict.fields || [];
		if (!fields.length) return;

		// The warning sentence is always visible; the values sit one click away
		// so the answer stays readable.
		this.addNote(row, "check this", conflict.text);

		var wrap = el("details", "msg__conflict");
		wrap.appendChild(el("summary", null,
			"Sources disagree on " + fields.length +
			(fields.length === 1 ? " figure" : " figures")));
		var list = el("ul", "msg__conflictList");
		fields.forEach(function (f) {
			var li = el("li", null);
			li.appendChild(el("strong", null, labelise(f.field)));
			var vals = (f.values || []).map(function (v) {
				return typeof v === "string" ? v : (v.value + (v.source ? " (" + v.source + ")" : ""));
			});
			var ul = el("ul", null);
			vals.forEach(function (v) { ul.appendChild(el("li", null, v)); });
			li.appendChild(ul);
			list.appendChild(li);
		});
		wrap.appendChild(list);
		row.appendChild(wrap);
		this.scroll();
	};

	ChatUI.prototype.addHandoff = function (row, handoff) {
		var wrap = el("div", "msg__handoff");
		Object.keys(handoff).forEach(function (k) {
			var v = handoff[k];
			var item = el("div", "msg__handoffItem");
			item.appendChild(el("span", "msg__handoffKey", k));
			var isPhone = /^[+0-9][0-9 ()-]{6,}$/.test(String(v));
			var isMail = String(v).indexOf("@") > -1;
			if (isPhone || isMail) {
				var a = el("a", "msg__handoffVal", v);
				a.href = (isMail ? "mailto:" : "tel:") + String(v).replace(/\s+/g, "");
				item.appendChild(a);
			} else {
				item.appendChild(el("span", "msg__handoffVal", v));
			}
			wrap.appendChild(item);
		});
		row.appendChild(wrap);
	};

	/* Bridges chat back to the page: the bot answered, now show the section
	 * that answer came from. */
	ChatUI.prototype.addJump = function (row, section) {
		var self = this;
		var meta = (this.engine.sections && this.engine.sections()[section]) || null;
		var label = meta ? meta.label : section;
		var anchor = meta ? meta.anchor : section;
		if (!document.getElementById(anchor)) return; // never offer a dead jump
		var b = el("button", "msg__jump", "Show me \u201C" + label + "\u201D on the page \u2192");
		b.type = "button";
		b.addEventListener("click", function () {
			if (self.opts.onNavigate) { self.opts.onNavigate(anchor, section); return; }
			var target = document.getElementById(anchor);
			target.scrollIntoView({ behavior: "smooth", block: "start" });
			target.classList.add("section--flash");
			global.setTimeout(function () { target.classList.remove("section--flash"); }, 1600);
		});
		row.appendChild(b);
		this.scroll();
	};

	/* Calibrated refusal, middle band: offer the suspect entries as one-tap
	 * questions instead of a dead-end or a guess. */
	ChatUI.prototype.addSuggestions = function (row, suggestions) {
		var self = this;
		var wrap = el("div", "msg__suggest");
		suggestions.forEach(function (sg) {
			var b = el("button", "msg__suggestBtn", sg.question);
			b.type = "button";
			b.addEventListener("click", function () { self.submit(sg.question); });
			wrap.appendChild(b);
		});
		row.appendChild(wrap);
		this.scroll();
	};

	/* Location answers bridge to the campus walk at exactly that stop. */
	ChatUI.prototype.addWalk = function (row, stopId, stopName) {
		var base = (global.location && /\/campus-explorer\//.test(global.location.pathname)) ? "../walk/" : "walk/";
		var a = el("a", "msg__walk", "See it on the campus walk \u2192");
		a.href = base + "?stop=" + encodeURIComponent(stopId);
		a.target = "_blank";
		a.rel = "noopener";
		if (stopName) a.title = stopName + " on the campus walk";
		row.appendChild(a);
		this.scroll();
	};

	/* Provenance line under every answer: which KB record answered, when that
	 * record was last changed, and the KB version. The date is the repository
	 * change date of the entry, not a re-verification with the college - the
	 * KB meta says so, and the freshness page (item 10) explains it. */
	ChatUI.prototype.addSource = function (row, source) {
		if (!source) return;
		var bits = ["Source: " + labelise(source.category || "knowledge base")];
		if (source.updated) bits.push("updated " + source.updated);
		if (source.kbVersion) bits.push("KB v" + source.kbVersion);
		row.appendChild(el("div", "msg__source", bits.join(" \u00B7 ")));
		this.scroll();
	};

	/* Thumbs up/down on answers. Ratings stay on this device (localStorage
	 * key hkbk_ratings): entry id, category and outcome only - never the raw
	 * question text. The export/admin view is the usage-log work (item 8). */
	ChatUI.prototype.addRating = function (row, res) {
		var self = this;
		var wrap = el("div", "msg__rate");
		wrap.appendChild(el("span", "msg__rateLabel", "Was this answer helpful?"));
		var done = false;
		function rate(value, btn) {
			if (done) return;
			done = true;
			try {
				var all = JSON.parse(global.localStorage.getItem("hkbk_ratings") || "[]");
				all.push({
					ts: new Date().toISOString(),
					type: "rating",
					rating: value,
					entryId: res.entryId || null,
					category: res.category || null,
					outcome: res.type
				});
				global.localStorage.setItem("hkbk_ratings", JSON.stringify(all));
			} catch (e) { /* storage full or blocked: rating is lost, chat is not */ }
			wrap.innerHTML = "";
			wrap.appendChild(el("span", "msg__rateThanks",
				value === "up" ? "Thanks - noted as helpful." : "Thanks - noted as not helpful."));
		}
		[["up", "\uD83D\uDC4D", "Rate this answer helpful"],
		 ["down", "\uD83D\uDC4E", "Rate this answer not helpful"]].forEach(function (spec) {
			var b = el("button", "msg__rateBtn", spec[1]);
			b.type = "button";
			b.setAttribute("aria-label", spec[2]);
			b.addEventListener("click", function () { rate(spec[0], b); });
			wrap.appendChild(b);
		});
		row.appendChild(wrap);
		this.scroll();
	};

	ChatUI.prototype.renderChips = function () {
		var self = this;
		this.chips.innerHTML = "";
		var list = (this.engine && this.engine.quickReplies) ? this.engine.quickReplies() : [];
		list.slice(0, 6).forEach(function (q) {
			var b = el("button", "chip", q);
			b.type = "button";
			b.addEventListener("click", function () { self.submit(q); });
			self.chips.appendChild(b);
		});
	};

	ChatUI.prototype.renderTrace = function (trace) {
		this.trace.textContent = JSON.stringify(trace, null, 1);
	};

	ChatUI.prototype.scroll = function () {
		this.log.scrollTop = this.log.scrollHeight;
	};

	/* ---------- the one interesting method ---------- */

	ChatUI.prototype.submit = function (question) {
		var self = this;
		this.addUser(question);
		this.busy = true;

		var thinking = this.addBot("\u2026", "thinking");

		// A short delay only so the transcript reads as a conversation. The
		// retrieval itself is synchronous and sub-millisecond; this is not a
		// fake loading state hiding real work.
		global.setTimeout(function () {
			var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
			var res;
			try {
				res = self.engine.ask(question);
			} catch (err) {
				thinking.remove();
				self.addBot("Something broke while looking that up. Please try rephrasing.", "error");
				self.busy = false;
				return;
			}
			var ms = ((global.performance && performance.now) ? performance.now() : Date.now()) - t0;

			thinking.remove();
			var kind = res.type === "out_of_scope" ? "refusal" : (res.type === "clarify" ? "clarify" : null);
			var row = self.addBot(res.answer, kind);

			if (res.conflict) {
				self.addConflicts(row, res.conflict);
			}
			if (res.handoff && Object.keys(res.handoff).length) {
				self.addHandoff(row, res.handoff);
			}
			if (res.unresolvedTokens && res.unresolvedTokens.length) {
				// Visible on purpose: a missing figure is a data gap, not something
				// to paper over with an invented number.
				self.addNote(row, "missing figure", res.unresolvedTokens.join(", "));
			}
			if (res.type === "clarify" && res.suggestions && res.suggestions.length) {
				self.addSuggestions(row, res.suggestions);
			}
			if (res.type === "answer" && res.section) {
				self.addJump(row, res.section);
			}
			if (res.type === "answer" && res.walkStop) {
				self.addWalk(row, res.walkStop, res.walkStopName);
			}
			if (res.type === "answer" && res.source) {
				self.addSource(row, res.source);
				self.addRating(row, res);
			}

			if (global.HKBKUsage && global.HKBKUsage.enabled()) {
				global.HKBKUsage.log(res.type === "answer" ? "answer" : (res.type === "clarify" ? "clarify" : "refusal"), {
					entryId: res.entryId || null,
					category: res.category || null,
					confidenceBand: global.HKBKUsage.band(res.confidence),
					ms: Math.round(ms)
				});
			}

			self.lastTrace = {
				query: question,
				lang: res.lang,
				entry: res.entryId || null,
				confidence: res.confidence,
				retrievalMs: Math.round(ms * 100) / 100,
				steps: res.trace || []
			};
			if (self.debug) self.renderTrace(self.lastTrace);

			self.busy = false;
			self.input.focus();
		}, 260);
	};

	/* ---------- session ---------- */

	/* One-time, in-transcript consent for the anonymous usage log. Plain
	 * language, both choices equal-sized, No deletes anything logged. */
	ChatUI.prototype.maybeAskUsageConsent = function () {
		var self = this;
		if (!global.HKBKUsage || global.HKBKUsage.choice() !== null) return;
		var row = el("div", "msg msg--bot msg--consent");
		var body = el("div", "msg__body");
		body.appendChild(el("div", null, "Help improve this bot? Share anonymous usage: what was answered or refused, never your question text. Stays on this device; you can export or delete it any time."));
		var wrap = el("div", "msg__consentBtns");
		[["Yes, share anonymous usage", "yes"], ["No thanks", "no"]].forEach(function (spec) {
			var b = el("button", "msg__suggestBtn", spec[0]);
			b.type = "button";
			b.addEventListener("click", function () {
				global.HKBKUsage.setChoice(spec[1]);
				row.remove();
				self.addBot(spec[1] === "yes"
					? "Thanks. Only outcomes are logged, never your questions. Turn this off any time from the admin view."
					: "No problem - nothing is logged.");
			});
			wrap.appendChild(b);
		});
		body.appendChild(wrap);
		row.appendChild(body);
		this.log.appendChild(row);
		this.scroll();
	};

	ChatUI.prototype.open = function () {
		this.root.classList.add("chat--open");
		this.input.focus();
		this.maybeAskUsageConsent();
	};

	ChatUI.prototype.close = function () {
		// Matches the paper: memory is per session and is discarded, not stored.
		if (this.engine && this.engine.endSession) this.engine.endSession();
		this.root.classList.remove("chat--open");
		if (this.opts.onClose) this.opts.onClose();
	};

	global.HKBKChatUI = { ChatUI: ChatUI };
})(typeof window !== "undefined" ? window : globalThis);
