/*
 * Walk instrumentation (2026-10): stops visited, dwell per stop, completion,
 * and two short presence questions. Anonymous and device-local only: events
 * sit in localStorage under hkbk_walk and leave the device only if the user
 * exports them (usage-log admin view). No names, no queries, no network.
 */
(function () {
	"use strict";
	var KEY = "hkbk_walk";
	function read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
	function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
	/* instrumentation shares the chat's usage opt-in: without consent,
	 * nothing is recorded at all */
	function consented() { return !!(window.HKBKUsage && window.HKBKUsage.enabled()); }
	function log(ev) {
		if (!consented()) return;
		var v = read(); ev.ts = new Date().toISOString(); v.push(ev);
		if (v.length > 500) v = v.slice(v.length - 500);
		write(v);
	}

	var sessionStart = Date.now();
	var current = null;      // current chapter stop id
	var enteredAt = null;    // when we entered it
	var visited = {};        // stop id -> total dwell ms
	var asked = false;

	function chapter() {
		/* the walk publishes a minimal read-only hook from its closure */
		return (window.__walkHook && window.__walkHook.chapter) ? window.__walkHook.chapter() : null;
	}

	function tick() {
		var id = chapter();
		var now = Date.now();
		if (id !== current) {
			if (current && enteredAt != null) {
				var dwell = now - enteredAt;
				/* a stop only counts as visited after a real pause, so
				 * scrubbing the progress bar cannot complete the walk */
				if (dwell >= 1500) {
					visited[current] = (visited[current] || 0) + dwell;
					log({ type: "stop", id: current, dwellMs: dwell });
				}
			}
			current = id;
			enteredAt = now;
			checkComplete();
		}
	}

	function checkComplete() {
		if (asked || !consented()) return;
		var anchors = (window.WALK && window.WALK.stops || []).filter(function (s) { return s.step != null; });
		var seen = anchors.filter(function (s) { return visited[s.id] != null; }).length;
		if (anchors.length && seen >= anchors.length) {
			asked = true;
			log({ type: "complete", stops: seen, totalMs: Date.now() - sessionStart });
			presenceQuestions();
		}
	}

	/* two short presence questions, once per walk completion, dismissible */
	function presenceQuestions() {
		var box = document.createElement("div");
		box.setAttribute("role", "dialog");
		box.setAttribute("aria-live", "polite");
		box.setAttribute("aria-label", "Walk feedback questions");
		box.style.cssText = "position:fixed;left:50%;bottom:76px;transform:translateX(-50%);" +
			"background:#0b1030;color:#f4f0e6;border-radius:12px;padding:14px 18px;z-index:60;" +
			"font:14px/1.5 system-ui,sans-serif;max-width:320px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
		var qs = [
			{ q: "Could you picture the campus layout from this walk?", key: "picture" },
			{ q: "Was the walk useful?", key: "useful" }
		];
		var i = 0;
		function ask() {
			if (i >= qs.length) { box.remove(); return; }
			box.innerHTML = "";
			var p = document.createElement("div");
			p.textContent = qs[i].q;
			p.style.marginBottom = "10px";
			box.appendChild(p);
			["Yes", "Somewhat", "No"].forEach(function (label) {
				var b = document.createElement("button");
				b.type = "button";
				b.textContent = label;
				b.style.cssText = "margin-right:8px;padding:6px 12px;border-radius:8px;border:1px solid #f4f0e6;" +
					"background:transparent;color:#f4f0e6;cursor:pointer";
				b.addEventListener("click", function () {
					log({ type: "presence", q: qs[i].key, a: label.toLowerCase() });
					i++;
					ask();
				});
				box.appendChild(b);
			});
			var x = document.createElement("button");
			x.type = "button";
			x.textContent = "Skip";
			x.style.cssText = "padding:6px 12px;border-radius:8px;border:0;background:transparent;" +
				"color:#9aa0c0;cursor:pointer;text-decoration:underline";
			x.addEventListener("click", function () { box.remove(); });
			box.appendChild(x);
		}
		ask();
		document.body.appendChild(box);
	var firstBtn = box.querySelector("button");
	if (firstBtn) firstBtn.focus();
	}

	/* the walk renders via requestAnimationFrame already; a light poll is
	 * simpler and safer than wrapping its internals */
	setInterval(tick, 500);
	function flush() {
		if (current && enteredAt != null) {
			var dwell = Date.now() - enteredAt;
			if (dwell >= 1500) {
				visited[current] = (visited[current] || 0) + dwell;
				log({ type: "stop", id: current, dwellMs: dwell });
			}
			enteredAt = Date.now();
		}
	}
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", function () {
		if (document.visibilityState === "hidden") flush();
	});
})();
