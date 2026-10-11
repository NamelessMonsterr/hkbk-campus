/*
 * Shared feature-detect for the three WebGL scenes (hero, gallery, transition).
 * Every scene must gate its init behind HKBK3D.canRender() so a page with no
 * WebGL or prefers-reduced-motion set falls back to the plain static markup
 * that already exists in index.html - no broken states, no console errors.
 */
(function (window) {
	"use strict";

	function probeWebgl() {
		try {
			var canvas = document.createElement("canvas");
			return !!(window.WebGLRenderingContext &&
				(canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
		} catch (e) {
			return false;
		}
	}

	function prefersReducedMotion() {
		return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	}

	var hasThree = typeof window.THREE !== "undefined";
	var webglOk = hasThree && probeWebgl();

	/* A soft radial-gradient sprite texture, reused for every particle/glow
	   effect across the three scenes. Additive blending on this stands in for
	   a bloom post-process pass (the vendored r140 build ships no
	   EffectComposer/UnrealBloomPass - those are examples/jsm modules, not
	   part of the global build), and reads far cheaper per-frame. */
	var glowTextureCache = null;
	function glowTexture() {
		if (glowTextureCache) return glowTextureCache;
		var size = 128;
		var c = document.createElement("canvas");
		c.width = c.height = size;
		var ctx = c.getContext("2d");
		var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		g.addColorStop(0, "rgba(255,255,255,1)");
		g.addColorStop(0.35, "rgba(255,255,255,0.55)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, size, size);
		glowTextureCache = new THREE.CanvasTexture(c);
		return glowTextureCache;
	}

	/* A drifting particle field of glowing points inside a cylindrical volume -
	   the "flying through space" depth cue shared by all three scenes. */
	function particleField(count, radius, length, color) {
		var positions = new Float32Array(count * 3);
		var speeds = new Float32Array(count);
		for (var i = 0; i < count; i++) {
			var a = Math.random() * Math.PI * 2;
			var r = Math.sqrt(Math.random()) * radius;
			positions[i * 3] = Math.cos(a) * r;
			positions[i * 3 + 1] = Math.sin(a) * r;
			positions[i * 3 + 2] = (Math.random() - 0.5) * length;
			speeds[i] = 0.4 + Math.random() * 1.2;
		}
		var geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		var mat = new THREE.PointsMaterial({
			size: radius * 0.018,
			map: glowTexture(),
			color: color,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});
		var points = new THREE.Points(geo, mat);
		points.userData.speeds = speeds;
		points.userData.length = length;
		return points;
	}

	/* One glowing hexagonal ring, built from a thin extruded hex annulus so it
	   catches real light (MeshStandardMaterial) rather than a flat line. */
	function hexRing(radius, thickness, color) {
		var shape = new THREE.Shape();
		var hole;
		function hexPoints(r) {
			var pts = [];
			for (var i = 0; i <= 6; i++) {
				var a = (i / 6) * Math.PI * 2;
				pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
			}
			return pts;
		}
		var outer = hexPoints(radius);
		shape.setFromPoints(outer);
		hole = new THREE.Path();
		hole.setFromPoints(hexPoints(radius - thickness));
		shape.holes.push(hole);

		var geo = new THREE.ExtrudeGeometry(shape, { depth: thickness * 0.5, bevelEnabled: false });
		var mat = new THREE.MeshStandardMaterial({
			color: color,
			emissive: color,
			emissiveIntensity: 0.65,
			metalness: 0.2,
			roughness: 0.4,
			transparent: true,
			opacity: 0.9
		});
		var mesh = new THREE.Mesh(geo, mat);
		return mesh;
	}

	window.HKBK3D = {
		canRender: function () {
			return webglOk && !prefersReducedMotion();
		},
		/* Read a CSS custom property so scenes match the page theme instead of
		   hardcoding colors twice. */
		cssColor: function (name, fallback) {
			var v = getComputedStyle(document.documentElement).getPropertyValue(name);
			return (v && v.trim()) || fallback;
		},
		glowTexture: glowTexture,
		particleField: particleField,
		hexRing: hexRing,
		/* Shared lazy-init helper: runs `onEnter` once when `target` nears the
		   viewport, and toggles `onVisible(isVisible)` on every crossing after
		   that so scenes can pause rendering when scrolled out of view. Mirrors
		   the .reveal/.is-in IntersectionObserver pattern already used in the
		   inline boot script in index.html. */
		observe: function (target, onEnter, onVisible) {
			if (!target) return;
			var started = false;
			if (!("IntersectionObserver" in window)) {
				started = true;
				onEnter();
				if (onVisible) onVisible(true);
				return;
			}
			var io = new IntersectionObserver(function (entries) {
				entries.forEach(function (entry) {
					if (entry.isIntersecting && !started) {
						started = true;
						onEnter();
					}
					if (started && onVisible) onVisible(entry.isIntersecting);
				});
			}, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });
			io.observe(target);
		}
	};
})(window);
