/*
 * About -> Courses chapter transition - "hex stargate": a tunnel of lit
 * glowing hex rings that the camera flies through as the visitor scrolls,
 * particle streaks rushing past, and a dark hex-bracket info card fading in
 * as real DOM (not in-scene 3D text, so it stays selectable/accessible) once
 * the portal has mostly opened.
 *
 * Fallback: the card already carries the .reveal class, so with no WebGL /
 * prefers-reduced-motion it just fades in via the existing generic
 * IntersectionObserver reveal system in index.html's boot script - no canvas,
 * no separate code path to keep in sync.
 */
(function () {
	"use strict";
	if (!window.HKBK3D) return;

	var wrap = document.getElementById("chapter-transition");
	if (!wrap) return;
	var card = wrap.querySelector(".chapter__card");

	var RING_COUNT = 10;
	var TUNNEL_LEN = 22;

	function start() {
		if (!window.HKBK3D.canRender()) return;

		var canvas = document.createElement("canvas");
		canvas.className = "chapter__canvas";
		canvas.setAttribute("aria-hidden", "true");
		wrap.insertBefore(canvas, wrap.firstChild);

		var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

		var scene = new THREE.Scene();
		var bg = new THREE.Color(window.HKBK3D.cssColor("--bg", "#0a0b0d"));
		scene.fog = new THREE.Fog(bg, 2, TUNNEL_LEN * 0.85);

		var camera = new THREE.PerspectiveCamera(60, 1, 0.1, 60);

		scene.add(new THREE.AmbientLight(0xffffff, 0.3));
		var point = new THREE.PointLight(0xffffff, 1.6, 24);
		scene.add(point);

		var hexColor = new THREE.Color(window.HKBK3D.cssColor("--hex-line", "#d6c496"));
		var accent = new THREE.Color(window.HKBK3D.cssColor("--accent", "#c24b3f"));

		var rings = [];
		for (var i = 0; i < RING_COUNT; i++) {
			var ring = window.HKBK3D.hexRing(1.4 + (i % 2) * 0.3, 0.08, i === RING_COUNT - 1 ? accent : hexColor);
			ring.position.z = -i * (TUNNEL_LEN / RING_COUNT);
			ring.userData.baseScale = 1;
			rings.push(ring);
			scene.add(ring);
		}

		var particles = window.HKBK3D.particleField(500, 2.2, TUNNEL_LEN, hexColor);
		particles.position.z = -TUNNEL_LEN / 2;
		scene.add(particles);

		function fit() {
			var rect = wrap.getBoundingClientRect();
			var w = Math.max(1, rect.width), h = Math.max(1, rect.height);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h, false);
		}
		fit();
		window.addEventListener("resize", fit, { passive: true });

		function progress() {
			var rect = wrap.getBoundingClientRect();
			var vh = window.innerHeight || document.documentElement.clientHeight;
			var p = (vh - rect.top) / (vh + rect.height);
			return Math.min(1, Math.max(0, p));
		}

		var running = true, spin = 0;
		function onScroll() {
			if (!running) return;
			var p = progress();

			camera.position.z = 4 - p * (TUNNEL_LEN - 2);
			point.position.set(0, 0, camera.position.z - 1);
			camera.lookAt(0, 0, camera.position.z - 6);

			rings.forEach(function (ring, i) {
				var s = 1 + p * 0.6 + i * 0.02;
				ring.scale.setScalar(s);
				ring.rotation.z = spin * (i % 2 === 0 ? 1 : -1) + i * 0.15;
			});
			particles.rotation.z = spin * 0.3;

			if (card) {
				var eased = p < 0.45 ? 0 : (p - 0.45) / 0.55;
				eased = Math.min(1, eased);
				card.style.opacity = String(eased);
				card.style.transform = "translateY(" + (1 - eased) * 26 + "px) scale(" + (0.94 + eased * 0.06) + ")";
			}
			renderer.render(scene, camera);
		}

		var raf = null;
		function tick() {
			if (!running) { raf = null; return; }
			raf = requestAnimationFrame(tick);
			spin += 0.004;
			onScroll();
		}
		window.addEventListener("scroll", onScroll, { passive: true });
		tick();

		window.HKBK3D.observe(wrap, function () {}, function (visible) {
			running = visible;
			if (visible && !raf) tick();
		});
	}

	window.HKBK3D.observe(wrap, start, null);
})();
