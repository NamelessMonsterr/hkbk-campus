/*
 * Campus "showcase" WebGL scene - a procedural hex-crystal field the visitor
 * flies through: dozens of lit, glowing hexagonal prisms scattered through a
 * real 3D volume, a drifting particle field, and a point light rigged to the
 * camera so faces light up as they're approached. Drag rotates the whole
 * field, the scroll wheel dollies the camera forward/back through it.
 *
 * This is deliberately abstract/procedural rather than photo-textured: Chrome
 * treats every file:// resource as its own opaque origin, so a local image or
 * video read into a WebGL texture via texImage2D comes back canvas-tainted
 * and renders solid black (confirmed empirically while building this) - a
 * hard platform wall under this project's "must open by double-click, no
 * server" requirement, not something fixable in code. The curated photos and
 * clips from the media pass are shown as ordinary HTML in this section
 * instead (see the .campusStrip markup in index.html), where they display
 * exactly as normal images/video always have on this page.
 *
 * Fallback: this script only ever adds a sibling element to the existing
 * .split two-image layout and .campusStrip inside #campus - it never removes
 * or hides that markup, so with no WebGL / prefers-reduced-motion the section
 * looks exactly as it did before this redesign, just without the 3D canvas.
 */
(function () {
	"use strict";
	if (!window.HKBK3D) return;

	var section = document.getElementById("campus");
	if (!section) return;

	function start() {
		if (!window.HKBK3D.canRender()) return;

		var host = document.createElement("div");
		host.className = "gallery3d";
		host.setAttribute("aria-hidden", "true");
		var innerWrap = section.querySelector(".section__inner");
		if (!innerWrap) return;
		innerWrap.appendChild(host);

		var hint = document.createElement("p");
		hint.className = "gallery3d__hint small";
		hint.textContent = "Drag to rotate, scroll to fly through";
		innerWrap.appendChild(hint);

		var canvas = document.createElement("canvas");
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		host.appendChild(canvas);

		var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

		var scene = new THREE.Scene();
		var bg = new THREE.Color(window.HKBK3D.cssColor("--bg", "#0a0b0d"));
		scene.fog = new THREE.Fog(bg, 3, 26);

		var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
		camera.position.set(0, 0, 3);

		scene.add(new THREE.AmbientLight(0xffffff, 0.32));
		var camLight = new THREE.PointLight(0xffffff, 1.8, 20);
		camera.add(camLight);
		scene.add(camera);

		var fieldGroup = new THREE.Group();
		scene.add(fieldGroup);

		var hexColor = new THREE.Color(window.HKBK3D.cssColor("--hex-line", "#d6c496"));
		var accent = new THREE.Color(window.HKBK3D.cssColor("--accent", "#c24b3f"));

		var CRYSTAL_COUNT = 46;
		var depth = 20;
		for (var i = 0; i < CRYSTAL_COUNT; i++) {
			var r = 0.28 + Math.random() * 0.55;
			var geo = new THREE.CylinderGeometry(r, r * 0.72, r * 1.8, 6);
			var color = Math.random() < 0.16 ? accent : hexColor;
			var mat = new THREE.MeshStandardMaterial({
				color: color, emissive: color, emissiveIntensity: 0.35,
				metalness: 0.35, roughness: 0.35, transparent: true, opacity: 0.88
			});
			var mesh = new THREE.Mesh(geo, mat);
			var a = Math.random() * Math.PI * 2;
			var rad = 1.6 + Math.random() * 4.2;
			mesh.position.set(Math.cos(a) * rad, (Math.random() - 0.5) * 6, Math.sin(a) * rad - Math.random() * depth);
			mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
			mesh.userData.spin = (Math.random() - 0.5) * 0.4;
			fieldGroup.add(mesh);
		}

		var particles = window.HKBK3D.particleField(650, 5, depth * 1.4, hexColor);
		particles.position.z = -depth / 2;
		scene.add(particles);

		function fit() {
			var rect = host.getBoundingClientRect();
			var w = Math.max(1, rect.width), h = Math.max(1, rect.height);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h, false);
		}
		fit();
		window.addEventListener("resize", fit, { passive: true });

		/* Drag to rotate the whole field, mouse or touch. */
		var rotation = 0, velocity = 0, dragging = false, lastX = 0;
		function pointerDown(x) { dragging = true; lastX = x; velocity = 0; }
		function pointerMove(x) {
			if (!dragging) return;
			var dx = x - lastX;
			lastX = x;
			velocity = dx * 0.006;
			rotation += velocity;
		}
		function pointerUp() { dragging = false; }
		host.addEventListener("mousedown", function (e) { pointerDown(e.clientX); });
		window.addEventListener("mousemove", function (e) { pointerMove(e.clientX); });
		window.addEventListener("mouseup", pointerUp);
		host.addEventListener("touchstart", function (e) { pointerDown(e.touches[0].clientX); }, { passive: true });
		host.addEventListener("touchmove", function (e) { pointerMove(e.touches[0].clientX); }, { passive: true });
		host.addEventListener("touchend", pointerUp);

		/* Scroll wheel dollies the camera forward/back through the field. */
		var camZ = 3, targetCamZ = camZ;
		var minZ = -depth + 2, maxZ = 4;
		host.addEventListener("wheel", function (e) {
			e.preventDefault();
			targetCamZ = Math.max(minZ, Math.min(maxZ, targetCamZ - e.deltaY * 0.012));
		}, { passive: false });

		var running = true, raf = null;
		function loop() {
			if (!running) { raf = null; return; }
			raf = requestAnimationFrame(loop);
			if (!dragging) {
				velocity *= 0.94;
				rotation += velocity + 0.0009;
			}
			fieldGroup.rotation.y = rotation;
			fieldGroup.children.forEach(function (m) { m.rotation.y += m.userData.spin * 0.01; });
			camZ += (targetCamZ - camZ) * 0.07;
			camera.position.z = camZ;
			renderer.render(scene, camera);
		}
		loop();

		window.HKBK3D.observe(host, function () {}, function (visible) {
			running = visible;
			if (visible && !raf) loop();
		});
	}

	window.HKBK3D.observe(section, start, null);
})();
