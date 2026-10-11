/*
 * Hero WebGL scene - "floating glass block": a procedural glass-and-steel
 * model of the HKBK academic block, hovering over a faint reflective floor,
 * orbited by drifting data particles, with a slow automatic day/night cycle
 * and reactions to mouse, scroll and CTA hover.
 *
 * Honesty note on tech stack: the vendored build is Three.js r140's plain
 * UMD bundle (js/vendor/three.min.js) - it does not include GLTFLoader,
 * OrbitControls, EffectComposer/BloomPass, or an SSAO pass; those live in
 * three/examples/jsm, which was never vendored (see js/3d/webgl-support.js
 * for the same constraint on the other two scenes). There is also no HDRI
 * asset in assets/. So "GLTF building" becomes a procedurally-built glass
 * tower, "bloom" becomes additive-blended glow sprites/materials, and
 * "HDRI environment" becomes matched ambient/directional/rim lights -
 * everything else in the brief (transmission glass, day/night, particle
 * orbit, mouse/scroll/hover reactions, reduced-motion + visibility gating)
 * is implemented for real against this renderer.
 *
 * Like the previous version of this file, the canvas is transparent and
 * fully replaces the static <img class="hero__figure">; nothing is read
 * into a WebGL texture, so the file:// canvas-tainting issue that ruled out
 * texturing local video/images never applies here - everything on screen is
 * built from real THREE geometry, materials and lights.
 *
 * Fallback: if HKBK3D.canRender() is false (no WebGL, or
 * prefers-reduced-motion), this file does nothing and the original
 * <img class="hero__figure"> renders exactly as it always has.
 */
(function () {
	"use strict";
	if (!window.HKBK3D) return;

	var figure = document.querySelector(".hero__figure");
	if (!figure) return;

	var DAY_COLOR = 0x1c2430;
	var NIGHT_COLOR = 0x05070c;
	var GLASS_COLOR = 0xbfd6e6;
	var STEEL_COLOR = 0xe9e4d6;
	var WINDOW_DAY = 0x9fb8c8;
	var WINDOW_NIGHT = 0x8fd4ff;
	var RIM_COLOR = 0x4f8fff;
	var SUN_DAY = 0xfff4e0;
	var SUN_NIGHT = 0x2c3a55;
	var CYCLE = 52; /* seconds for one full day->night->day loop */

	function start() {
		if (!window.HKBK3D.canRender()) return;

		var img = figure.querySelector("img");

		var canvas = document.createElement("canvas");
		canvas.style.position = "absolute";
		canvas.style.inset = "0";
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.setAttribute("aria-hidden", "true");

		var width = window.innerWidth;
		var tier = width < 720 ? "mobile" : (width < 1100 ? "tablet" : "desktop");
		var counts = { desktop: 900, tablet: 450, mobile: 220 }[tier];

		var renderer, scene, camera, buildingGroup, reflectionGroup,
			floor, particles, hexBackdrop, sun, rim, amb, dpr;
		var running = true, raf = null;
		var windows = []; /* { mesh, phase } */
		var clockStart = null;

		function dims() {
			var rect = figure.getBoundingClientRect();
			return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
		}

		function glassBlock(w, h, d, color, opacity) {
			var geo = new THREE.BoxGeometry(w, h, d);
			var mat;
			if (THREE.MeshPhysicalMaterial) {
				mat = new THREE.MeshPhysicalMaterial({
					color: color,
					metalness: 0.05,
					roughness: 0.08,
					transmission: 0.85,
					thickness: 0.6,
					ior: 1.4,
					transparent: true,
					opacity: opacity
				});
			} else {
				mat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.1, roughness: 0.15, transparent: true, opacity: opacity });
			}
			var mesh = new THREE.Mesh(geo, mat);
			var edges = new THREE.LineSegments(
				new THREE.EdgesGeometry(geo),
				new THREE.LineBasicMaterial({ color: STEEL_COLOR, transparent: true, opacity: 0.55 })
			);
			mesh.add(edges);
			return mesh;
		}

		function windowStrip(w, h, y, z, front) {
			var geo = new THREE.BoxGeometry(w, h, 0.04);
			var mat = new THREE.MeshStandardMaterial({
				color: WINDOW_DAY,
				emissive: WINDOW_DAY,
				emissiveIntensity: 0.15,
				roughness: 0.3,
				metalness: 0.1
			});
			var mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(0, y, z);
			mesh.rotation.y = front ? 0 : Math.PI / 2;
			windows.push({ mesh: mesh, phase: Math.random() * Math.PI * 2 });
			return mesh;
		}

		function buildBuilding() {
			var group = new THREE.Group();

			var main = glassBlock(5.4, 1.7, 2.1, GLASS_COLOR, 0.55);
			main.position.y = 0;
			group.add(main);

			var wing = glassBlock(2.2, 1.15, 2.6, GLASS_COLOR, 0.5);
			wing.position.set(-2.9, -0.55, 0.15);
			group.add(wing);

			var podium = glassBlock(6.2, 0.35, 2.6, STEEL_COLOR, 0.35);
			podium.position.y = -1.05;
			group.add(podium);

			/* thin metallic fins across the glass front, echoing the real
			   academic block's vertical facade lines */
			var finMat = new THREE.MeshStandardMaterial({ color: STEEL_COLOR, metalness: 0.85, roughness: 0.3 });
			for (var i = 0; i < 9; i++) {
				var fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.75, 2.14), finMat);
				fin.position.set(-2.6 + i * 0.65, 0, 0);
				group.add(fin);
			}

			/* glowing window strips, tracked in `windows` so they can breathe
			   and brighten at night */
			for (var row = -1; row <= 1; row++) {
				group.add(windowStrip(5.0, 0.22, row * 0.55, 1.06, true));
			}
			group.add(windowStrip(2.4, 1.0, -0.55, 0.15, false));

			return group;
		}

		function buildReflection(source) {
			var group = source.clone(true);
			group.traverse(function (node) {
				if (node.isMesh) {
					node.material = node.material.clone();
					node.material.opacity = (node.material.opacity || 1) * 0.28;
					node.material.transparent = true;
					if (node.material.emissiveIntensity !== undefined) {
						node.material.emissiveIntensity *= 0.5;
					}
				}
				if (node.isLineSegments) {
					node.material = node.material.clone();
					node.material.opacity *= 0.3;
				}
			});
			group.scale.y = -1;
			return group;
		}

		function buildFloor() {
			var geo = new THREE.CircleGeometry(9, 48);
			var mat = new THREE.MeshStandardMaterial({
				color: 0x0c1016,
				metalness: 0.75,
				roughness: 0.18,
				transparent: true,
				opacity: 0.85
			});
			var mesh = new THREE.Mesh(geo, mat);
			mesh.rotation.x = -Math.PI / 2;
			mesh.position.y = -2.05;
			return mesh;
		}

		function buildHexBackdrop() {
			var group = new THREE.Group();
			var color = new THREE.Color(window.HKBK3D.cssColor("--hex-line", "#d6c496"));
			var cols = 6, rows = 4;
			for (var c = 0; c < cols; c++) {
				for (var r = 0; r < rows; r++) {
					var ring = window.HKBK3D.hexRing(0.55, 0.03, color);
					ring.material.opacity = 0.16;
					ring.material.emissiveIntensity = 0.25;
					var xOff = (r % 2) * 0.65;
					ring.position.set(-5 + c * 1.3 + xOff, -1.5 + r * 1.15, -9 - Math.random() * 2.5);
					group.add(ring);
				}
			}
			return group;
		}

		function buildParticles(count) {
			var positions = new Float32Array(count * 3);
			var kinds = new Float32Array(count);   /* 0 orbit, 1 upward, 2 spiral */
			var radii = new Float32Array(count);
			var angles = new Float32Array(count);
			var heights = new Float32Array(count);
			var speeds = new Float32Array(count);
			var phases = new Float32Array(count);

			for (var i = 0; i < count; i++) {
				var kind = Math.random();
				kinds[i] = kind < 0.55 ? 0 : (kind < 0.8 ? 1 : 2);
				radii[i] = 2.4 + Math.random() * 3.2;
				angles[i] = Math.random() * Math.PI * 2;
				heights[i] = (Math.random() - 0.5) * 4;
				speeds[i] = 0.15 + Math.random() * 0.5;
				phases[i] = Math.random() * Math.PI * 2;
				positions[i * 3] = Math.cos(angles[i]) * radii[i];
				positions[i * 3 + 1] = heights[i];
				positions[i * 3 + 2] = Math.sin(angles[i]) * radii[i];
			}

			var geo = new THREE.BufferGeometry();
			var posAttr = new THREE.BufferAttribute(positions, 3);
			posAttr.setUsage(THREE.DynamicDrawUsage);
			geo.setAttribute("position", posAttr);

			var mat = new THREE.PointsMaterial({
				size: 0.06,
				map: window.HKBK3D.glowTexture(),
				color: WINDOW_DAY,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
				blending: THREE.AdditiveBlending
			});

			var points = new THREE.Points(geo, mat);
			points.userData = { kinds: kinds, radii: radii, angles: angles, heights: heights, speeds: speeds, phases: phases };
			return points;
		}

		function init() {
			var d = dims();
			dpr = Math.min(window.devicePixelRatio || 1, 2);

			renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
			renderer.setPixelRatio(dpr);
			renderer.setSize(d.w, d.h, false);
			renderer.physicallyCorrectLights = true;
			renderer.outputEncoding = THREE.sRGBEncoding;
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.05;

			scene = new THREE.Scene();
			scene.background = new THREE.Color(DAY_COLOR);
			scene.fog = new THREE.Fog(DAY_COLOR, 6, 20);

			camera = new THREE.PerspectiveCamera(42, d.w / d.h, 0.1, 100);
			camera.position.set(0, 0.6, 8.5);
			camera.lookAt(0, 0, 0);

			amb = new THREE.AmbientLight(0xffffff, 0.5);
			scene.add(amb);

			sun = new THREE.DirectionalLight(SUN_DAY, 1.4);
			sun.position.set(4, 5, 3);
			scene.add(sun);

			rim = new THREE.PointLight(RIM_COLOR, 1.1, 20);
			rim.position.set(-4, 1, -3);
			scene.add(rim);

			buildingGroup = buildBuilding();
			buildingGroup.position.y = 0.35;
			scene.add(buildingGroup);

			reflectionGroup = buildReflection(buildingGroup);
			reflectionGroup.position.y = -1.65;
			scene.add(reflectionGroup);

			floor = buildFloor();
			scene.add(floor);

			hexBackdrop = buildHexBackdrop();
			scene.add(hexBackdrop);

			particles = buildParticles(counts);
			scene.add(particles);

			figure.appendChild(canvas);
			if (img) img.style.display = "none";

			window.addEventListener("resize", onResize, { passive: true });
			figure.addEventListener("mousemove", onMouseMove, { passive: true });
			figure.addEventListener("mouseleave", onMouseLeave, { passive: true });
			window.addEventListener("scroll", onScroll, { passive: true });

			var ctas = document.querySelectorAll(".hero .pill--solid");
			for (var i = 0; i < ctas.length; i++) {
				ctas[i].addEventListener("mouseenter", function () { hoverTarget = 1; });
				ctas[i].addEventListener("mouseleave", function () { hoverTarget = 0; });
			}

			clockStart = new THREE.Clock();
			loop(clockStart);
		}

		/* -- interaction state -- */
		var mouseTargetX = 0, mouseTargetY = 0;
		var camAngle = 0, camTilt = 0;
		var MAX_ROT = 0.1745; /* 10deg in radians */

		function onMouseMove(e) {
			var rect = figure.getBoundingClientRect();
			mouseTargetX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
			mouseTargetY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
		}
		function onMouseLeave() {
			mouseTargetX = 0;
			mouseTargetY = 0;
		}

		var scrollProgress = 0;
		function onScroll() {
			var vh = window.innerHeight || 1;
			var p = 1 - Math.min(1, Math.max(0, figure.getBoundingClientRect().top / vh));
			scrollProgress = Math.min(1, Math.max(0, p * 0.85));

			var heroTop = document.querySelector(".hero__top");
			var heroWord = document.querySelector(".hero__word");
			var heroMeta = document.querySelector(".hero__meta");
			var shift = scrollProgress * 26;
			if (heroTop) heroTop.style.transform = "translateY(" + (-shift * 0.5) + "px)";
			if (heroWord) heroWord.style.transform = "translateY(" + (-shift) + "px)";
			if (heroMeta) heroMeta.style.transform = "translateY(" + (-shift * 0.35) + "px)";
		}

		var hoverTarget = 0, hoverLevel = 0;

		function onResize() {
			var d = dims();
			camera.aspect = d.w / d.h;
			camera.updateProjectionMatrix();
			renderer.setSize(d.w, d.h, false);
		}

		var dayColor = new THREE.Color(DAY_COLOR);
		var nightColor = new THREE.Color(NIGHT_COLOR);
		var sunDay = new THREE.Color(SUN_DAY);
		var sunNight = new THREE.Color(SUN_NIGHT);
		var winDay = new THREE.Color(WINDOW_DAY);
		var winNight = new THREE.Color(WINDOW_NIGHT);
		var particleGlow = new THREE.Color();

		function loop(clock) {
			if (!running) { raf = null; return; }
			raf = requestAnimationFrame(function () { loop(clock); });

			var dt = Math.min(0.05, clock.getDelta());
			var t = clock.getElapsedTime();

			/* -- day/night cycle: smooth sine crossfade, never a hard cut -- */
			var night = Math.sin((t / CYCLE) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;

			scene.background.lerpColors(dayColor, nightColor, night);
			scene.fog.color.copy(scene.background);
			sun.color.lerpColors(sunDay, sunNight, night);
			sun.intensity = 1.5 - night * 0.9;
			amb.intensity = 0.55 - night * 0.25;
			rim.intensity = 0.7 + night * 0.9;

			for (var w = 0; w < windows.length; w++) {
				var win = windows[w];
				var flicker = 0.85 + Math.sin(t * 1.6 + win.phase) * 0.15;
				win.mesh.material.color.lerpColors(winDay, winNight, night);
				win.mesh.material.emissive.copy(win.mesh.material.color);
				win.mesh.material.emissiveIntensity = (0.15 + night * 1.3) * flicker + hoverLevel * 0.4;
			}

			/* -- building: float, breathe, tiny vibration, very slow spin -- */
			buildingGroup.position.y = 0.35 + Math.sin(t * 0.55) * 0.14;
			buildingGroup.position.x = Math.sin(t * 3.3) * 0.003;
			buildingGroup.rotation.y = t * 0.025 + scrollProgress * 0.35;
			var breathe = 1 + Math.sin(t * 0.7) * 0.006;
			buildingGroup.scale.setScalar(breathe);

			reflectionGroup.position.y = -1.65 - Math.sin(t * 0.55) * 0.14;
			reflectionGroup.position.x = buildingGroup.position.x;
			reflectionGroup.rotation.y = buildingGroup.rotation.y;
			reflectionGroup.scale.setScalar(breathe);

			hexBackdrop.rotation.z += dt * 0.006;
			hexBackdrop.position.y = Math.sin(t * 0.2) * 0.15;

			/* -- particles: orbit / upward drift / spiral, with fade -- */
			var u = particles.userData;
			var pos = particles.geometry.attributes.position.array;
			var speedMul = (1 + scrollProgress * 1.6) * (1 + hoverLevel * 0.5);
			for (var i = 0; i < u.kinds.length; i++) {
				var ix = i * 3;
				if (u.kinds[i] === 0) {
					u.angles[i] += dt * u.speeds[i] * 0.25 * speedMul;
					pos[ix] = Math.cos(u.angles[i]) * u.radii[i];
					pos[ix + 2] = Math.sin(u.angles[i]) * u.radii[i];
					pos[ix + 1] = u.heights[i] + Math.sin(t * 0.6 + u.phases[i]) * 0.25;
				} else if (u.kinds[i] === 1) {
					u.heights[i] += dt * u.speeds[i] * speedMul;
					if (u.heights[i] > 3.2) u.heights[i] = -3.2;
					pos[ix] = Math.cos(u.angles[i]) * u.radii[i];
					pos[ix + 2] = Math.sin(u.angles[i]) * u.radii[i];
					pos[ix + 1] = u.heights[i];
				} else {
					u.angles[i] += dt * u.speeds[i] * 0.6 * speedMul;
					u.heights[i] += dt * u.speeds[i] * 0.3 * speedMul;
					if (u.heights[i] > 3.2) u.heights[i] = -3.2;
					var r = u.radii[i] * (0.6 + 0.4 * (Math.sin(t * 0.3 + u.phases[i]) * 0.5 + 0.5));
					pos[ix] = Math.cos(u.angles[i]) * r;
					pos[ix + 2] = Math.sin(u.angles[i]) * r;
					pos[ix + 1] = u.heights[i];
				}
			}
			particles.geometry.attributes.position.needsUpdate = true;
			particleGlow.lerpColors(winDay, winNight, night);
			particles.material.color.copy(particleGlow);
			particles.material.opacity = 0.65 + night * 0.3 + hoverLevel * 0.15;

			/* -- camera: mouse orbit (max 10deg), smooth return, scroll dolly -- */
			hoverLevel += (hoverTarget - hoverLevel) * 0.06;
			camAngle += (mouseTargetX * MAX_ROT - camAngle) * 0.045;
			camTilt += (mouseTargetY * MAX_ROT * 0.6 - camTilt) * 0.045;

			var radius = 8.5 - scrollProgress * 2.4 - hoverLevel * 0.4;
			camera.position.x = Math.sin(camAngle) * radius;
			camera.position.z = Math.cos(camAngle) * radius;
			camera.position.y = 0.6 + camTilt * radius * 0.5;
			camera.lookAt(0, 0.1, 0);

			renderer.render(scene, camera);
		}

		init();

		window.HKBK3D.observe(figure, function () {}, function (visible) {
			running = visible;
			if (visible && !raf && renderer) loop(clockStart);
		});

		document.addEventListener("visibilitychange", function () {
			running = !document.hidden;
			if (running && !raf && renderer) loop(clockStart);
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
