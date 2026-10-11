/*
 * HKBK Campus Explorer - Phase 1 of the digital-twin rebuild.
 *
 * Unlike the rest of the site, this file is a real ES module and requires
 * an http(s) origin (see campus.html's top comment and README.md). It uses
 * the genuine Three.js addon pipeline - GLTFLoader, DRACOLoader,
 * EffectComposer, UnrealBloomPass, SSAOPass, OrbitControls,
 * PointerLockControls - loaded from jsDelivr via the import map in
 * campus.html, rather than the offline r140 UMD bundle the classic scenes
 * use (js/vendor/three.min.js). That bundle has none of those addons; this
 * page trades offline-from-file:// for the real rendering stack.
 *
 * Honesty notes, up front:
 *  - There are no real .glb models of the campus buildings yet. Every
 *    building below is defined with an `assets/models/<id>.glb` path AND a
 *    procedural fallback. GLTFLoader is really invoked; if the file 404s
 *    (which it will, today) the fallback box-and-glass model is used
 *    instead and a console.info says so. Drop a real model at that path
 *    and it will load automatically - no code change needed.
 *  - Building info text is pulled live from the *real* knowledge base
 *    (window.HKBK_KB) via the *real* chatbot engine (window.HKBKChat), the
 *    same one the main site uses. Nothing here invents facts about the
 *    college. Where the knowledge base has nothing specific to a building
 *    (e.g. the library), the panel says so instead of making something up.
 *  - Weather, interiors, the historical timeline and analytics layers are
 *    NOT in this file. See the comment in js/3d/campus/README.md (or ask)
 *    for what Phase 2/3 would add.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

/* ------------------------------------------------------------------ *
 * Building registry - the one source of truth for what exists.
 * `kbEntryId` points at a real entry in data/knowledge-base.json; the
 * panel quotes it through the real engine so tokens (placement %, fees
 * etc.) resolve exactly like they do on the main site.
 *
 * `entranceHeading` is the compass-style heading (degrees, 0 = +z, the
 * direction the road ring approaches from) that the building's main door
 * faces. The Semantic Cinematic Director needs it to frame an entrance
 * shot; buildings that omit it get a neutral framing instead of a
 * confident shot of a blank wall. These are placeholder values chosen to
 * face the internal road, NOT surveyed - they should be corrected against
 * the real campus layout before any evaluation study.
 * ------------------------------------------------------------------ */
var BUILDINGS = [
	{
		id: "main-block", name: "Main Academic Block", aliases: ["main block", "academic block", "main building"], entranceHeading: 0,
		pos: [0, 0], size: [55, 22, 20], kind: "glass", section: "about", kbEntryId: "about-college"
	},
	{
		id: "library", name: "Library", aliases: ["library", "central library"], entranceHeading: 55,
		pos: [-81, -44], size: [34, 19, 31], kind: "block", section: "campus", kbEntryId: "campus-facilities"
	},
	{
		id: "hostel", name: "Hostel", aliases: ["hostel", "hostels", "residence"], entranceHeading: -60,
		pos: [88, -37], size: [31, 38, 31], kind: "block", section: "hostel", kbEntryId: "fees-hostel"
	},
	{
		id: "canteen", name: "Canteen", aliases: ["canteen", "food court", "mess", "arogya"], entranceHeading: 130,
		pos: [-66, 59], size: [26, 15, 26], kind: "block", section: "campus", kbEntryId: "canteen-food"
	},
	{
		id: "admin", name: "Admissions & Placement Cell", aliases: ["admin", "administration", "placement cell", "admissions office", "placement office"], entranceHeading: -145,
		pos: [74, 59], size: [29, 21, 25], kind: "block", section: "placements", kbEntryId: "placements"
	}
];

/* Metres. The campus was previously authored in arbitrary units; the real
 * main-block model is 55 m wide, so the whole scene was converted to
 * metres (factor 7.35, preserving the existing relative layout) when it
 * landed. Every constant below is now a real-world dimension. Building
 * sizes other than the main block remain estimates. */
var CAMPUS_RADIUS = 147;

function boot() {
	var canvas = document.getElementById("campus-canvas");
	var bootEl = document.getElementById("campus-boot");
	var fallbackEl = document.getElementById("campus-fallback");
	var hudEl = document.getElementById("campus-hud");
	var guideEl = document.getElementById("campus-guide");
	var infoEl = document.getElementById("campus-info");

	var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	var webglOk = (function () {
		try {
			var c = document.createElement("canvas");
			return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
		} catch (e) { return false; }
	})();

	if (!webglOk) {
		bootEl.hidden = true;
		fallbackEl.hidden = false;
		return;
	}

	var width = window.innerWidth;
	var tier = width < 720 ? "mobile" : (width < 1100 ? "tablet" : "desktop");
	var treeCount = { desktop: 260, tablet: 130, mobile: 60 }[tier];
	var useSSAO = tier === "desktop";

	var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === "mobile" ? 1.5 : 2));
	renderer.setSize(window.innerWidth, window.innerHeight, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	var scene = new THREE.Scene();
	var dayColor = new THREE.Color(0x1c2430);
	var nightColor = new THREE.Color(0x05070c);
	scene.background = dayColor.clone();
	scene.fog = new THREE.Fog(dayColor.getHex(), 150, 520);

	var camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 3000);
	camera.position.set(0, 66, 176);

	/* ---- lights ----
	 * Image-based lighting is the primary source: assets/hdr/campus-sky.hdr
	 * is a real 32-bit radiance file (vendored, no CDN - see
	 * tools/make-hdri.py for how it is generated and what its limitations
	 * are) run through PMREMGenerator so every PBR material gets a correct
	 * pre-filtered irradiance + specular environment. The directional light
	 * below is only there to cast shadows and give a readable sun direction;
	 * it is deliberately weaker than the previous build's 2.2, because the
	 * environment is now doing most of the work. Ambient is gone entirely -
	 * a flat AmbientLight is exactly what makes a scene read as "student
	 * project", since it lifts shadows uniformly and kills all form.
	 */
	var pmrem = new THREE.PMREMGenerator(renderer);
	pmrem.compileEquirectangularShader();
	var envRT = null;

	new RGBELoader().load(
		"assets/hdr/campus-sky.hdr",
		function (hdr) {
			hdr.mapping = THREE.EquirectangularReflectionMapping;
			envRT = pmrem.fromEquirectangular(hdr);
			scene.environment = envRT.texture;
			hdr.dispose();
			pmrem.dispose();
			envReady = true;
		},
		undefined,
		function () {
			/* No HDRI on disk: fall back to a dim hemisphere so materials
			 * are still lit rather than black. Visibly worse, deliberately
			 * not silent. */
			console.warn("[campus] assets/hdr/campus-sky.hdr failed to load - falling back to hemisphere light. Run tools/make-hdri.py.");
			scene.add(new THREE.HemisphereLight(0x9fc0e8, 0x2a2620, 0.9));
			envReady = true;
		}
	);
	var envReady = false;

	var sun = new THREE.DirectionalLight(0xfff2dc, 1.35);
	/* Matched to the sun disc baked into campus-sky.hdr (azimuth 58 deg,
	 * elevation 34 deg in tools/make-hdri.py). If the two disagree, glass
	 * reflects a highlight from one direction while shadows fall from
	 * another, and the scene reads as fake even if nobody can say why. */
	sun.position.set(210, 165, -135);
	sun.castShadow = true;
	sun.shadow.mapSize.set(tier === "desktop" ? 2048 : 1024, tier === "desktop" ? 2048 : 1024);
	sun.shadow.camera.left = -180; sun.shadow.camera.right = 180;
	sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180;
	sun.shadow.camera.far = 620;
	sun.shadow.bias = -0.0009;
	sun.shadow.normalBias = 0.28;
	sun.shadow.radius = 3;
	scene.add(sun);

	/* Cool fill from the shaded side, at a fraction of the sun's strength -
	 * stands in for sky bounce that the environment map alone under-reads on
	 * vertical surfaces. */
	var rim = new THREE.DirectionalLight(0x6f9fd8, 0.35);
	rim.position.set(-135, 66, -105);
	scene.add(rim);

	/* Emissive materials animated on the day/night curve. Declared here
	 * because both the landscape (lamp heads) and the buildings (windows)
	 * register into it, and the landscape is built first. */
	var windowMats = [];

	/* ---- ground, boundary, roads ---- */
	/* Ground and paving pick up the same generated concrete maps the
	 * building uses, so surfaces vary instead of reading as flat colour.
	 * Loaded async - if the textures are missing the materials simply stay
	 * flat, which is what they were before. */
	var texLoader = new THREE.TextureLoader();
	function surfaceMaps(material, repeat) {
		["concrete_albedo", "concrete_normal", "concrete_orm"].forEach(function (name, slot) {
			texLoader.load("assets/textures/" + name + ".png", function (tex) {
				tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
				tex.repeat.set(repeat, repeat);
				if (slot === 0) { tex.colorSpace = THREE.SRGBColorSpace; material.map = tex; }
				if (slot === 1) { material.normalMap = tex; material.normalScale.set(0.6, 0.6); }
				if (slot === 2) { material.roughnessMap = tex; material.aoMap = tex; }
				material.needsUpdate = true;
			}, undefined, function () { /* stay flat */ });
		});
		return material;
	}

	var groundMat = surfaceMaps(new THREE.MeshStandardMaterial({ color: 0x2c3a28, roughness: 0.95, metalness: 0.0 }), 60);
	var ground = new THREE.Mesh(new THREE.CircleGeometry(CAMPUS_RADIUS, 64), groundMat);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	var wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.7, metalness: 0.2 });
	var wall = new THREE.Mesh(new THREE.TorusGeometry(CAMPUS_RADIUS - 2.2, 1.8, 8, 64), wallMat);
	wall.rotation.x = Math.PI / 2;
	wall.position.y = 1.8;
	scene.add(wall);

	var roadMat = surfaceMaps(new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.88 }), 40);
	var road = new THREE.Mesh(new THREE.RingGeometry(99, 114, 64), roadMat);
	road.rotation.x = -Math.PI / 2;
	road.position.y = 0.07;
	road.receiveShadow = true;
	scene.add(road);

	var parkingMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.9 });
	var parking = new THREE.Mesh(new THREE.PlaneGeometry(44, 30), parkingMat);
	parking.rotation.x = -Math.PI / 2;
	parking.position.set(118, 0.14, 88);
	scene.add(parking);

	/* ---- landscape detail -------------------------------------------
	 * Curbs, bay markings, footpaths and lamp posts. None of it is
	 * individually noticed; collectively it is most of the difference
	 * between "a few boxes on a disc" and somewhere that reads as a place.
	 * All instanced or single-geometry, so the cost is a handful of draw
	 * calls. Positions are plausible, NOT surveyed - the real campus
	 * layout is not known to this level of detail.
	 * ------------------------------------------------------------------ */

	/* Kerb either side of the ring road */
	var kerbMat = new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.85 });
	[98.4, 114.6].forEach(function (radius) {
		var kerb = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.16, 6, 96), kerbMat);
		kerb.rotation.x = Math.PI / 2;
		kerb.position.y = 0.16;
		kerb.receiveShadow = true;
		scene.add(kerb);
	});

	/* Painted bay markings in the car park */
	var paintMat = new THREE.MeshBasicMaterial({ color: 0xcfcabb, transparent: true, opacity: 0.5 });
	var bayGeo = new THREE.PlaneGeometry(0.16, 5.2);
	var bays = new THREE.InstancedMesh(bayGeo, paintMat, 18);
	var bd = new THREE.Object3D();
	for (var bi = 0; bi < 18; bi++) {
		bd.position.set(118 - 20 + bi * 2.4, 0.16, 88 - 6);
		bd.rotation.x = -Math.PI / 2;
		bd.updateMatrix();
		bays.setMatrixAt(bi, bd.matrix);
	}
	scene.add(bays);

	/* Footpath from the ring road to the main block entrance */
	var pathMat = surfaceMaps(new THREE.MeshStandardMaterial({ color: 0x8b8780, roughness: 0.92 }), 12);
	var path = new THREE.Mesh(new THREE.PlaneGeometry(9, 84), pathMat);
	path.rotation.x = -Math.PI / 2;
	path.position.set(0, 0.09, 56);
	path.receiveShadow = true;
	scene.add(path);

	/* Lawn in front of the entrance - the grass strip in the photographs */
	var lawnMat = new THREE.MeshStandardMaterial({ color: 0x33502c, roughness: 0.95 });
	[[-26, 40], [26, 40]].forEach(function (pos) {
		var lawn = new THREE.Mesh(new THREE.PlaneGeometry(34, 44), lawnMat);
		lawn.rotation.x = -Math.PI / 2;
		lawn.position.set(pos[0], 0.08, pos[1]);
		lawn.receiveShadow = true;
		scene.add(lawn);
	});

	/* Lamp posts around the ring road. Emissive heads are pushed into
	 * windowMats so they light up on the same day/night curve as the
	 * building windows - one animation path, not two. */
	var postMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.55, metalness: 0.6 });
	var lampMat = new THREE.MeshStandardMaterial({ color: 0xffe6bd, emissive: 0xffe6bd, emissiveIntensity: 0.1, roughness: 0.4 });
	windowMats.push(lampMat);
	var LAMPS = tier === "mobile" ? 12 : 24;
	var posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 7.4, 6), postMat, LAMPS);
	var heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 6), lampMat, LAMPS);
	posts.castShadow = true;
	var ld = new THREE.Object3D();
	for (var li = 0; li < LAMPS; li++) {
		var la = (li / LAMPS) * Math.PI * 2;
		var lx = Math.cos(la) * 96.5, lz = Math.sin(la) * 96.5;
		ld.position.set(lx, 3.7, lz); ld.rotation.set(0, 0, 0); ld.updateMatrix();
		posts.setMatrixAt(li, ld.matrix);
		ld.position.y = 7.6; ld.updateMatrix();
		heads.setMatrixAt(li, ld.matrix);
	}
	scene.add(posts, heads);

	/* ---- instanced trees, scattered outside building footprints ---- */
	var trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 3.4, 6);
	var leafGeo = new THREE.ConeGeometry(2.4, 5.6, 7);
	var trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
	var leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a34, roughness: 0.85 });
	var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
	var leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
	trunks.castShadow = leaves.castShadow = true;
	var dummy = new THREE.Object3D();
	var placed = 0, attempts = 0;
	while (placed < treeCount && attempts < treeCount * 20) {
		attempts++;
		var a = Math.random() * Math.PI * 2;
		var r = 22 + Math.random() * (CAMPUS_RADIUS - 37);
		var x = Math.cos(a) * r, z = Math.sin(a) * r;
		var tooClose = BUILDINGS.some(function (b) {
			var dx = x - b.pos[0], dz = z - b.pos[1];
			return Math.sqrt(dx * dx + dz * dz) < Math.max(b.size[0], b.size[2]) * 0.75 + 9;
		});
		if (tooClose || (r > 97 && r < 116)) continue;
		dummy.position.set(x, 1.7, z);
		dummy.rotation.y = Math.random() * Math.PI;
		var s = 0.7 + Math.random() * 0.6;
		dummy.scale.setScalar(s);
		dummy.updateMatrix();
		trunks.setMatrixAt(placed, dummy.matrix);
		dummy.position.y = 1.7 + 3.2 * s;
		dummy.updateMatrix();
		leaves.setMatrixAt(placed, dummy.matrix);
		placed++;
	}
	trunks.count = leaves.count = placed;
	scene.add(trunks, leaves);

	/* ---- buildings: real GLTF attempt, procedural fallback ---- */
	var dracoLoader = new DRACOLoader();
	dracoLoader.setDecoderPath("js/vendor/three/examples/jsm/libs/draco/gltf/");
	var gltfLoader = new GLTFLoader();
	gltfLoader.setDRACOLoader(dracoLoader);

	var buildingMeshes = {}; /* id -> THREE.Object3D, for raycasting + highlight */
	var labels = [];         /* { sprite, building } */

	function proceduralBuilding(b) {
		var group = new THREE.Group();
		var w = b.size[0], h = b.size[1], d = b.size[2];
		var glass = b.kind === "glass";
		/* Values retuned for IBL. Under the old ambient-light setup a glass
		 * material needed high opacity to read at all; with a real
		 * environment it can be genuinely thin and let the sky do the work.
		 * The concrete gets a mid-high roughness and a trace of metalness -
		 * enough to pick up a grazing sheen at low sun without looking wet. */
		var bodyMat = glass
			? new THREE.MeshPhysicalMaterial({
				color: 0xaec6d8, metalness: 0.0, roughness: 0.06,
				transmission: 0.92, thickness: 1.2, ior: 1.46,
				clearcoat: 1.0, clearcoatRoughness: 0.04,
				envMapIntensity: 1.35, transparent: true, opacity: 0.92
			})
			: new THREE.MeshStandardMaterial({
				color: 0xcfc9bb, roughness: 0.72, metalness: 0.04,
				envMapIntensity: 1.0
			});
		var body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
		body.position.y = h / 2;
		body.castShadow = body.receiveShadow = true;
		var edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xe9e4d6, transparent: true, opacity: 0.5 }));
		body.add(edges);
		group.add(body);

		var winMat = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, emissive: 0x9fb8c8, emissiveIntensity: 0.15, roughness: 0.3 });
		windowMats.push(winMat);
		var cols = Math.max(2, Math.round(w));
		var rows = Math.max(1, Math.round(h / 1.1));
		for (var c = 0; c < cols; c++) {
			for (var r = 0; r < rows; r++) {
				var win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.03), winMat);
				win.position.set(-w / 2 + 0.6 + c * ((w - 1.2) / Math.max(1, cols - 1)), 0.7 + r * 1.1, d / 2 + 0.02);
				group.add(win);
			}
		}

		group.position.set(b.pos[0], 0, b.pos[1]);
		group.userData.buildingId = b.id;
		return group;
	}

	function makeLabel(b, group) {
		var c = document.createElement("canvas");
		c.width = 256; c.height = 64;
		var ctx = c.getContext("2d");
		ctx.fillStyle = "rgba(10,11,13,0.72)";
		if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, 8, 256, 48, 12); ctx.fill(); }
		else { ctx.fillRect(0, 8, 256, 48); }
		ctx.font = "600 22px sans-serif";
		ctx.fillStyle = "#ece9e3";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(b.name, 128, 32);
		var tex = new THREE.CanvasTexture(c);
		var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.62 }));
		sprite.scale.set(25, 6.2, 1);
		sprite.position.set(b.pos[0], b.size[1] + 8, b.pos[1]);
		sprite.renderOrder = 10;
		scene.add(sprite);
		labels.push({ sprite: sprite, building: b });
	}

	/* Contact shadows. The shadow map alone leaves buildings looking like
	 * they hover: at grazing sun angles the darkest occlusion right at the
	 * base is the first thing PCF softening throws away. This is the cheap
	 * archviz fix - a radial-gradient decal under each footprint, blended
	 * multiplicatively into the ground. Costs one 128px texture, shared. */
	var contactTex = (function () {
		var c = document.createElement("canvas");
		c.width = c.height = 128;
		var g = c.getContext("2d");
		var grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
		grd.addColorStop(0.0, "rgba(0,0,0,0.62)");
		grd.addColorStop(0.45, "rgba(0,0,0,0.28)");
		grd.addColorStop(1.0, "rgba(0,0,0,0)");
		g.fillStyle = grd;
		g.fillRect(0, 0, 128, 128);
		var t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		return t;
	})();

	function makeContactShadow(b) {
		var spread = Math.max(b.size[0], b.size[2]) * 1.5;
		var mat = new THREE.MeshBasicMaterial({
			map: contactTex, transparent: true, depthWrite: false,
			blending: THREE.MultiplyBlending, opacity: 0.95
		});
		var mesh = new THREE.Mesh(new THREE.PlaneGeometry(spread, spread), mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(b.pos[0], 0.015, b.pos[1]);
		mesh.renderOrder = 1;
		scene.add(mesh);
	}

	BUILDINGS.forEach(function (b) {
		makeContactShadow(b);
		var placeholder = proceduralBuilding(b);
		scene.add(placeholder);
		buildingMeshes[b.id] = placeholder;
		makeLabel(b, placeholder);

		gltfLoader.load(
			"assets/models/" + b.id + ".glb",
			function (gltf) {
				scene.remove(placeholder);
				var real = gltf.scene;
				real.position.set(b.pos[0], 0, b.pos[1]);
				real.userData.buildingId = b.id;
				real.traverse(function (n) {
					if (!n.isMesh) return;
					n.castShadow = n.receiveShadow = true;
					/* glTF PBR materials default to envMapIntensity 1;
					 * the vendored HDRI is the only light source doing
					 * fine work on the curtain wall, so lift it slightly
					 * for the metallic surfaces and leave matte ones alone. */
					if (n.material && typeof n.material.envMapIntensity === "number") {
						n.material.envMapIntensity = (n.material.metalness > 0.4) ? 1.4 : 1.0;
					}
					if (n.material) n.material.needsUpdate = true;
				});
				scene.add(real);
				buildingMeshes[b.id] = real;
				/* A real model is almost never the size of the placeholder
				 * box, so the Director's metadata is refreshed from its
				 * actual bounding box. Every shot is relative, so they all
				 * re-frame themselves with no re-authoring. */
				setBoundsFromObject(b.id, real);
			},
			undefined,
			function () {
				console.info("[campus] no model at assets/models/" + b.id + ".glb yet - using procedural placeholder for \"" + b.name + "\".");
			}
		);
	});

	/* ---- post-processing: real bloom + SSAO, not faked ---- */
	var composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	var bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.4, 0.82);
	composer.addPass(bloomPass);
	var ssaoPass = null;
	if (useSSAO) {
		ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
		ssaoPass.kernelRadius = 6;
		ssaoPass.minDistance = 0.001;
		ssaoPass.maxDistance = 0.35;
		composer.addPass(ssaoPass);
	}
	composer.addPass(new OutputPass());

	/* ---- camera controls: orbit (default) + walk (pointer lock) ---- */
	var orbit = new OrbitControls(camera, renderer.domElement);
	orbit.target.set(0, 11, 0);
	orbit.enableDamping = true;
	orbit.dampingFactor = 0.08;
	orbit.minDistance = 28;
	orbit.maxDistance = 420;
	orbit.maxPolarAngle = Math.PI * 0.49;
	orbit.enablePan = false;
	orbit.rotateSpeed = 0.55;      /* slower than default - reads as weight */
	orbit.zoomSpeed = 0.7;
	orbit.dampingFactor = 0.045;   /* longer momentum tail */

	/* ------------------------------------------------------------------ *
	 * Cinematic intro.
	 *
	 * A single scripted camera move on load: high drone altitude, slow
	 * glide in, a bank into a diagonal descent toward the main block's
	 * entrance, settling into a held frame the user then takes over.
	 * Position and look-at are separate Catmull-Rom curves so the camera
	 * can lead or trail its subject rather than staring at one point the
	 * whole way down - that separation is most of what makes a move read
	 * as "shot" instead of "tweened".
	 *
	 * Skippable: any pointer/key/wheel input hands control over
	 * immediately. Nobody should be trapped in a 15-second title sequence
	 * on a second visit.
	 * ------------------------------------------------------------------ */
	var INTRO_DURATION = 15.0;
	var mainBlock = BUILDINGS[0];
	/* Re-derived in metres after the model landed. Altitudes are now real:
	 * the move starts 260 m up, where the whole 300 m campus reads, and
	 * settles at 14 m - roughly fourth-floor height, which frames the
	 * 22 m block without looking up its nose. */
	var settleTarget = new THREE.Vector3(mainBlock.pos[0], 11, mainBlock.pos[1]);
	var settlePos = new THREE.Vector3(mainBlock.pos[0] + 46, 14, mainBlock.pos[1] + 78);

	var introPath = new THREE.CatmullRomCurve3([
		new THREE.Vector3(-330, 260, 470),  /* campus barely readable */
		new THREE.Vector3(-215, 200, 375),
		new THREE.Vector3(-90, 130, 275),   /* trees start to occlude the block */
		new THREE.Vector3(20, 78, 195),     /* bank begins here */
		new THREE.Vector3(64, 38, 128),     /* diagonal descent */
		settlePos.clone()
	], false, "catmullrom", 0.28);

	var introLook = new THREE.CatmullRomCurve3([
		new THREE.Vector3(0, 0, -40),       /* wide: whole campus */
		new THREE.Vector3(0, 4, -22),
		new THREE.Vector3(0, 7, -4),
		new THREE.Vector3(0, 11, 10),       /* tightening onto the main block */
		new THREE.Vector3(0, 11, 7),
		settleTarget.clone()
	], false, "catmullrom", 0.28);

	var intro = { active: true, t: 0, skipped: false };
	orbit.enabled = false;

	var introOverlay = document.getElementById("campus-intro");
	var introBrand = document.getElementById("campus-intro-brand");

	function endIntro(immediate) {
		if (!intro.active) return;
		intro.active = false;
		intro.skipped = !!immediate;
		if (immediate) {
			camera.position.copy(settlePos);
			camera.rotation.z = 0;
		}
		orbit.target.copy(settleTarget);
		orbit.enabled = true;
		orbit.update();
		/* Let the wordmark fade rather than cutting: `is-done` sets
		 * display:none, so it has to wait out the CSS transition. */
		if (introOverlay) introOverlay.classList.add("is-clear", "is-fading");
		if (introBrand) introBrand.classList.remove("is-visible");
		window.setTimeout(function () {
			if (introOverlay) introOverlay.classList.add("is-done");
		}, 1400);
		if (hudEl) hudEl.hidden = false;
		if (guideEl) guideEl.hidden = false;
	}

	var skipBtn = document.getElementById("campus-intro-skip");
	if (skipBtn) skipBtn.addEventListener("click", function () { endIntro(true); });

	["pointerdown", "wheel", "keydown", "touchstart"].forEach(function (evt) {
		window.addEventListener(evt, function () {
			if (intro.active) endIntro(true);
		}, { passive: true });
	});

	/* Idle "breathing" - a sub-degree drift applied on top of whatever the
	 * orbit controls are doing. Amplitude is deliberately below the
	 * threshold where it reads as motion; it just stops the frame from
	 * feeling frozen when nobody is touching anything. */
	var breathOffset = new THREE.Vector3();
	var lastUserInput = performance.now();
	orbit.addEventListener("start", function () { lastUserInput = performance.now(); });
	orbit.addEventListener("change", function () { lastUserInput = performance.now(); });

	var walkControls = new PointerLockControls(camera, renderer.domElement);
	var mode = "orbit";
	var walkKeys = { w: false, a: false, s: false, d: false };
	var walkVelocity = new THREE.Vector3();

	function setMode(next) {
		var prev = mode;
		mode = next;
		document.querySelectorAll("#campus-hud .campus-hud__modes button").forEach(function (btn) {
			btn.classList.toggle("is-active", btn.dataset.mode === next);
		});
		if (prev === "tour" && next !== "tour") exitTour();
		if (next === "walk") {
			orbit.enabled = false;
			camera.position.set(0, 1.7, 70);
		} else if (next === "tour") {
			enterTour();
		} else {
			walkControls.unlock();
			orbit.enabled = true;
		}
	}
	document.querySelectorAll("#campus-hud .campus-hud__modes button").forEach(function (btn) {
		btn.addEventListener("click", function () { setMode(btn.dataset.mode); });
	});
	renderer.domElement.addEventListener("click", function () {
		if (mode === "walk") walkControls.lock();
	});
	document.addEventListener("keydown", function (e) {
		if (mode !== "walk") return;
		if (e.code === "KeyW") walkKeys.w = true;
		if (e.code === "KeyA") walkKeys.a = true;
		if (e.code === "KeyS") walkKeys.s = true;
		if (e.code === "KeyD") walkKeys.d = true;
	});
	document.addEventListener("keyup", function (e) {
		if (e.code === "KeyW") walkKeys.w = false;
		if (e.code === "KeyA") walkKeys.a = false;
		if (e.code === "KeyS") walkKeys.s = false;
		if (e.code === "KeyD") walkKeys.d = false;
	});

	/* ---- click-to-focus + info panel, driven off the real KB ---- */
	var raycaster = new THREE.Raycaster();
	var pointer = new THREE.Vector2();
	var engine = (window.HKBKChat && window.HKBK_KB) ? new window.HKBKChat.Engine(window.HKBK_KB) : null;

	var infoTitle = document.getElementById("campus-info-title");
	var infoBody = document.getElementById("campus-info-body");
	var infoLink = document.getElementById("campus-info-link");
	var infoWhy = document.getElementById("campus-why");
	document.getElementById("campus-info-close").addEventListener("click", function () { infoEl.hidden = true; });

	function kbTextFor(entryId) {
		if (!engine || !window.HKBK_KB) return null;
		var entry = window.HKBK_KB.entries.filter(function (e) { return e.id === entryId; })[0];
		if (!entry || !entry.en) return null;
		var resolved = window.HKBKChat.internals.resolveTokens(entry.en.a, window.HKBK_KB.meta && window.HKBK_KB.meta.tokens, "en");
		return resolved.text;
	}

	function openInfo(b, decision) {
		infoTitle.textContent = b.name;
		var text = kbTextFor(b.kbEntryId);
		infoBody.textContent = text || "No building-specific description is in the knowledge base yet - this is a placeholder model. Add one to data/knowledge-base.json and it will show up here automatically.";
		infoLink.href = "index.html#" + b.section;

		/* Explainability. The camera made a decision on the user's behalf;
		 * showing the reasoning is what separates this from a black box,
		 * and it is what the evaluation study will ask participants to
		 * judge. Absent decision = a plain click, nothing to explain. */
		if (infoWhy) {
			if (decision) {
				infoWhy.hidden = false;
				infoWhy.innerHTML = "";
				var rows = [
					["Intent", decision.intentLabel + (decision.intentFallback ? " (no match - default)" : "")],
					["Confidence", decision.intentFallback ? "\u2014" : decision.intentConfidence.toFixed(2)],
					["Shot", decision.shotName + (decision.shotDegraded ? " (substituted)" : "")],
					["Lens", Math.round(decision.camera.fov) + "\u00b0 vertical FOV"],
					["Framing", decision.composition]
				];
				rows.forEach(function (r) {
					var dt = document.createElement("dt");
					dt.textContent = r[0];
					var dd = document.createElement("dd");
					dd.textContent = r[1];
					infoWhy.appendChild(dt);
					infoWhy.appendChild(dd);
				});
				/* Scene context row - only shown when it actually exists,
				 * so an opening query doesn't display an empty field. */
				if (csm && sceneCtx && csm.isFresh(sceneCtx)) {
					var snap = csm.describe(sceneCtx, spatialMeta);
					if (snap && snap.previous) {
						var pdt = document.createElement("dt");
						pdt.textContent = "Context";
						var pdd = document.createElement("dd");
						pdd.textContent = "came from " + ((spatialMeta[snap.previous] || {}).name || snap.previous);
						infoWhy.appendChild(pdt);
						infoWhy.appendChild(pdd);
					}
				}

				var why = document.createElement("p");
				why.className = "campus-why__reason";
				why.textContent = decision.reason;
				infoWhy.appendChild(why);
			} else {
				infoWhy.hidden = true;
			}
		}
		infoEl.hidden = false;
	}

	/* Used by relational answers ("what's nearby"), which move no camera
	 * and therefore have no Director decision to explain - but still made
	 * a grounding decision worth showing. */
	function showContext(grounding) {
		if (!infoWhy || !csm || !sceneCtx) return;
		var snap = csm.describe(sceneCtx, spatialMeta);
		if (!snap) return;
		infoTitle.textContent = snap.building;
		infoBody.textContent = "Relational query answered against the building currently in view. The camera was not moved.";
		infoLink.href = "index.html#campus";
		infoWhy.hidden = false;
		infoWhy.innerHTML = "";
		[["Grounded to", snap.building],
		 ["Reference", grounding.kind],
		 ["Last shot", snap.lastShot || "\u2014"],
		 ["Context age", snap.ageSeconds + "s"]].forEach(function (r) {
			var dt = document.createElement("dt");
			dt.textContent = r[0];
			var dd = document.createElement("dd");
			dd.textContent = r[1];
			infoWhy.appendChild(dt);
			infoWhy.appendChild(dd);
		});
		var p = document.createElement("p");
		p.className = "campus-why__reason";
		p.textContent = grounding.reason;
		infoWhy.appendChild(p);
		infoEl.hidden = false;
	}

	var highlightUntil = {};
	var director = (typeof window !== "undefined" && window.HKBKDirector) ? window.HKBKDirector : null;
	var csm = (typeof window !== "undefined" && window.HKBKSceneContext) ? window.HKBKSceneContext : null;
	var sceneCtx = csm ? csm.create() : null;
	var telemetryLib = (typeof window !== "undefined" && window.HKBKTelemetry) ? window.HKBKTelemetry : null;
	var telemetry = telemetryLib ? telemetryLib.create() : null;
	/* Operator handle. Nothing is sent anywhere - a run leaves this page
	 * only when someone calls export() and saves the result themselves. */
	if (telemetry) {
		window.HKBKTrace = {
			summary: function () { return telemetryLib.summarize(telemetry); },
			problems: function () { return telemetryLib.problems(telemetry); },
			json: function () { return telemetryLib.toJSON(telemetry, true); },
			csv: function () { return telemetryLib.toCSV(telemetry); },
			clear: function () { return telemetryLib.clear(telemetry); },
			raw: telemetry
		};
	}
	if (!director) {
		console.warn("[campus] director.js did not load - falling back to a single generic fly-to for every query.");
	}
	if (!csm) {
		console.warn("[campus] scene-context.js did not load - follow-up questions will not be spatially grounded.");
	}

	/* Metadata handed to the Director. Note it contains no meshes,
	 * materials or Three.js types - the Director is deliberately blind to
	 * the renderer, so this is the entire surface between them. Bounds
	 * come from the registry today; when a real .glb replaces a box, this
	 * should be recomputed from the loaded model's bounding box instead
	 * (see setBoundsFromObject below) and every shot re-solves itself. */
	var spatialMeta = {};
	BUILDINGS.forEach(function (b) {
		spatialMeta[b.id] = {
			id: b.id, name: b.name,
			position: [b.pos[0], b.pos[1]],
			bounds: { width: b.size[0], height: b.size[1], depth: b.size[2] },
			entranceHeading: b.entranceHeading
		};
	});

	function setBoundsFromObject(id, object3d) {
		var box = new THREE.Box3().setFromObject(object3d);
		var size = box.getSize(new THREE.Vector3());
		if (size.x > 0 && size.y > 0 && size.z > 0 && spatialMeta[id]) {
			spatialMeta[id].bounds = { width: size.x, height: size.y, depth: size.z };
		}
	}
	window.HKBKCampusMeta = spatialMeta;

	/* The generic fly-to is kept as the Director-less fallback path and as
	 * the control condition for the evaluation study: it is exactly the
	 * behaviour the system had before the Director existed, so the two can
	 * be compared directly. */
	function genericFlyTo(b) {
		var targetPos = new THREE.Vector3(b.pos[0], b.size[1] * 0.45, b.pos[1]);
		var dist = Math.max(b.size[0], b.size[2]) * 1.9 + 22;
		var camGoal = new THREE.Vector3(b.pos[0] + dist * 0.6, dist * 0.45, b.pos[1] + dist * 0.8);
		tweenCamera(camGoal, targetPos, 1.5, camera.fov);
	}

	/* directTo() is the Director path: query in, cinematic decision out.
	 * Returns the decision so the caller can display why it framed things
	 * the way it did. */
	function directTo(buildingId, query) {
		var b = BUILDINGS.filter(function (x) { return x.id === buildingId; })[0];
		if (!b) return null;
		if (intro.active) endIntro(true);
		if (mode === "walk") setMode("orbit");

		var decision = null;
		if (director) {
			try {
				decision = director.direct({ query: query || "", target: spatialMeta[b.id] });
			} catch (err) {
				console.warn("[campus] director failed, using generic fly-to:", err.message);
			}
		}

		if (decision) {
			tweenCamera(
				new THREE.Vector3(decision.camera.position.x, decision.camera.position.y, decision.camera.position.z),
				new THREE.Vector3(decision.camera.target.x, decision.camera.target.y, decision.camera.target.z),
				decision.camera.duration,
				decision.camera.fov,
				decision.camera.ease
			);
		} else {
			genericFlyTo(b);
		}

		highlightUntil[b.id] = performance.now() + 2200;
		/* The only place scene context is ever written. */
		if (csm && sceneCtx && decision) csm.record(sceneCtx, decision);
		openInfo(b, decision);
		return decision;
	}

	function flyTo(buildingId) { return directTo(buildingId, ""); }

	/* Public hooks. flyTo keeps its old signature so anything already
	 * calling it (links from index.html) still works. */
	window.HKBKCampus = { flyTo: flyTo, directTo: directTo };

	var tween = null;
	var EASES = {
		easeInOutCubic: function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
		easeOutCubic: function (p) { return 1 - Math.pow(1 - p, 3); },
		easeInOutQuad: function (p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
	};
	function tweenCamera(posGoal, targetGoal, seconds, fovGoal, easeName) {
		tween = {
			t: 0, dur: seconds,
			fromPos: camera.position.clone(), toPos: posGoal,
			fromTarget: orbit.target.clone(), toTarget: targetGoal,
			fromFov: camera.fov, toFov: (typeof fovGoal === "number" ? fovGoal : camera.fov),
			ease: EASES[easeName] || EASES.easeInOutQuad
		};
	}

	/* ---- hover: soft illumination lift + label + cursor affordance ----
	 * Raycasting every pointermove is wasteful at 120Hz on a trackpad, so
	 * the hit test is throttled to roughly one per frame and the visual
	 * response is smoothed in the loop rather than snapping. */
	var hoveredId = null;
	var hoverAmt = {};
	var hoverPending = null;

	renderer.domElement.addEventListener("pointermove", function (e) {
		if (mode === "walk" || intro.active) { hoveredId = null; return; }
		hoverPending = { x: e.clientX, y: e.clientY };
	});
	renderer.domElement.addEventListener("pointerleave", function () {
		hoveredId = null;
		hoverPending = null;
		renderer.domElement.style.cursor = "";
	});

	function resolveHover() {
		if (!hoverPending) return;
		var rect = renderer.domElement.getBoundingClientRect();
		pointer.x = ((hoverPending.x - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((hoverPending.y - rect.top) / rect.height) * 2 + 1;
		hoverPending = null;
		raycaster.setFromCamera(pointer, camera);
		var targets = Object.keys(buildingMeshes).map(function (k) { return buildingMeshes[k]; });
		var hits = raycaster.intersectObjects(targets, true);
		var found = null;
		if (hits.length) {
			var o = hits[0].object;
			while (o && !o.userData.buildingId) o = o.parent;
			if (o) found = o.userData.buildingId;
		}
		if (found !== hoveredId) {
			hoveredId = found;
			renderer.domElement.style.cursor = found ? "pointer" : "";
		}
	}

	renderer.domElement.addEventListener("click", function (e) {
		if (mode === "walk") return;
		var rect = renderer.domElement.getBoundingClientRect();
		pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera);
		var targets = Object.keys(buildingMeshes).map(function (k) { return buildingMeshes[k]; });
		var hits = raycaster.intersectObjects(targets, true);
		if (!hits.length) return;
		var obj = hits[0].object;
		while (obj && !obj.userData.buildingId) obj = obj.parent;
		if (obj) flyTo(obj.userData.buildingId);
	});

	/* ---- AI guide: real chatbot engine + a small building-name matcher ---- */
	var guideLog = document.getElementById("campus-guide-log");
	var guideForm = document.getElementById("campus-guide-form");
	var guideInput = document.getElementById("campus-guide-input");

	function logLine(text, cls) {
		var p = document.createElement("p");
		p.className = cls;
		p.textContent = text;
		guideLog.appendChild(p);
		guideLog.scrollTop = guideLog.scrollHeight;
	}

	function matchBuilding(query) {
		var q = query.toLowerCase();
		var best = null, bestLen = 0;
		BUILDINGS.forEach(function (b) {
			[b.name].concat(b.aliases).forEach(function (name) {
				var n = name.toLowerCase();
				if (q.indexOf(n) !== -1 && n.length > bestLen) { best = b; bestLen = n.length; }
			});
		});
		return best;
	}

	guideForm.addEventListener("submit", function (e) {
		e.preventDefault();
		var q = guideInput.value.trim();
		if (!q) return;
		logLine(q, "is-user");
		guideInput.value = "";

		/* Pipeline timing starts here and stops when the response is
		 * decided - it deliberately excludes camera animation and frame
		 * time, which are not what this number is measuring. */
		var t0 = performance.now();
		function trace(fields) {
			if (!telemetry) return;
			fields.query = q;
			fields.latencyMs = performance.now() - t0;
			telemetryLib.record(telemetry, fields);
		}

		/* The Director now handles framing, so the guide no longer needs
		 * its own nav-intent regex to decide *whether* to move - it only
		 * needs to know which building the query is about. The Director
		 * decides how to present it, and reports why. */
		var building = matchBuilding(q);

		/* Conversational Spatial Memory: if the query names no building,
		 * it may still be *about* one - "how many books are there" after
		 * flying to the library. Grounding is attempted only when explicit
		 * matching fails, so a named building always wins over context. */
		var grounding = null;
		if (!building && csm && sceneCtx) {
			grounding = csm.resolveReference(q, sceneCtx);

			if (grounding.resolved && grounding.kind === "nearby") {
				var around = csm.nearby(grounding.targetId, spatialMeta, { limit: 3 });
				var originName = (spatialMeta[grounding.targetId] || {}).name || grounding.targetId;
				logLine("Around " + originName + ": " + csm.describeNearby(around), "is-guide");
				around.forEach(function (n) {
					highlightUntil[n.id] = performance.now() + 3000;
				});
				showContext(grounding);
				trace({
					outcome: "relational", contextUsed: true, contextKind: "nearby",
					contextResolved: true, building: grounding.targetId, answered: true
				});
				return;
			}

			if (grounding.resolved) {
				building = BUILDINGS.filter(function (x) { return x.id === grounding.targetId; })[0] || null;
			} else if (grounding.kind) {
				/* A reference was used but could not be grounded. Say so
				 * rather than answering as if it had been - this is the
				 * fail-closed path and it is deliberate. */
				logLine(grounding.reason + " Name the building and I'll take you there.", "is-guide");
				trace({
					outcome: "ungrounded_reference", contextUsed: false,
					contextKind: grounding.kind, contextResolved: false, answered: false
				});
				return;
			}
		}

		if (building) {
			var decision = directTo(building.id, q);
			if (decision) {
				logLine(
					decision.targetName + " \u2014 " + decision.shotName.toLowerCase() +
					" (" + decision.intentLabel.toLowerCase() + ")" +
					(grounding && grounding.resolved ? ", from context." : "."),
					"is-guide"
				);
			} else {
				logLine("Flying to " + building.name + ".", "is-guide");
			}
			/* A building match does not mean the question was only about
			 * getting there - answer it too if the engine has something. */
			var answered = false;
			if (engine) {
				var alsoRes = engine.ask(q);
				if (alsoRes && alsoRes.answer && alsoRes.type !== "out_of_scope") {
					logLine(alsoRes.answer, "is-guide");
					answered = true;
				}
			}
			trace({
				outcome: "navigated",
				intent: decision ? decision.intent : null,
				intentConfidence: decision ? decision.intentConfidence : null,
				intentFallback: decision ? decision.intentFallback : false,
				contextUsed: !!(grounding && grounding.resolved),
				contextKind: grounding ? grounding.kind : null,
				contextResolved: grounding ? grounding.resolved : null,
				building: building.id,
				shot: decision ? decision.shot : null,
				shotDegraded: decision ? decision.shotDegraded : false,
				fov: decision ? decision.camera.fov : null,
				explained: decision ? (typeof decision.reason === "string" && decision.reason.length > 0) : null,
				answered: true
			});
			return;
		}
		if (engine) {
			var res = engine.ask(q);
			logLine(res.answer + (res.hedged ? " (not fully confident - try rephrasing.)" : ""), "is-guide");
			trace({
				outcome: res.type === "out_of_scope" ? "refused" : "answered",
				answered: res.type !== "out_of_scope"
			});
		} else {
			logLine("The knowledge base didn't load, so I can only navigate right now - try \"take me to the library\".", "is-guide");
			trace({ outcome: "no_engine", answered: false });
		}
	});

	/* ------------------------------------------------------------------ *
	 * Guided tour.
	 *
	 * A ground-level walk-through: you start outside the gate at eye
	 * height and step from building to building, rather than being dropped
	 * into an orbit 170 m up. The camera GLIDES along the ring road
	 * between stops instead of cutting, so the walk between buildings is
	 * part of what you see - which is the whole point of doing it this way
	 * rather than teleporting.
	 *
	 * This is a presentation-layer feature only. It does not touch the
	 * Director, CSM or telemetry: a tour stop reuses openInfo() for its
	 * panel and carries no camera decision, because the camera position is
	 * scripted by the route rather than reasoned about from a query. Shot
	 * selection stays the Director's job and stays query-driven.
	 *
	 * LIMITATIONS, same as walk mode: the glide has no collision and the
	 * ground is flat, so the route is authored to stay on open ground
	 * rather than solved. Stand-off distances are derived from each
	 * building's own footprint, so they stay correct if a real model
	 * replaces a placeholder box.
	 * ------------------------------------------------------------------ */
	var EYE = 1.7;                 /* matches walk mode's eye height */
	var GATE = { x: 0, z: 135 };   /* main gate, south edge of the ring */

	/* Where the camera stands to view a building: out in front of its
	 * entrance, far enough back that the whole facade reads. */
	function standPoint(b) {
		var h = (b.entranceHeading || 0) * Math.PI / 180;
		var dist = Math.max(b.size[0], b.size[2]) * 0.6 + 16;
		return new THREE.Vector3(
			b.pos[0] + Math.sin(h) * dist,
			EYE,
			b.pos[1] + Math.cos(h) * dist
		);
	}
	function lookPoint(b) {
		return new THREE.Vector3(b.pos[0], b.size[1] * 0.38, b.pos[1]);
	}

	/* Route order walks a loop rather than criss-crossing the middle. */
	var TOUR_IDS = ["main-block", "admin", "hostel", "library", "canteen"];
	var TOUR_STOPS = [{
		id: "gate",
		name: "Main Gate",
		building: null,
		pos: new THREE.Vector3(GATE.x, EYE, GATE.z + 6),
		look: new THREE.Vector3(GATE.x, 6, GATE.z - 40)
	}].concat(TOUR_IDS.map(function (id) {
		var b = BUILDINGS.filter(function (x) { return x.id === id; })[0];
		return b ? { id: id, name: b.name, building: b, pos: standPoint(b), look: lookPoint(b) } : null;
	}).filter(Boolean));

	var tour = { index: 0, glide: null, auto: false, autoT: 0 };
	var AUTO_HOLD = 6.0;   /* seconds held at a stop before auto-advancing */

	var tourEl = document.getElementById("campus-tour");
	var tourCount = document.getElementById("campus-tour-count");
	var tourName = document.getElementById("campus-tour-name");
	var tourPrev = document.getElementById("campus-tour-prev");
	var tourNext = document.getElementById("campus-tour-next");
	var tourAuto = document.getElementById("campus-tour-auto");
	var tourExit = document.getElementById("campus-tour-exit");

	function tourSyncUi() {
		if (!tourEl) return;
		var s = TOUR_STOPS[tour.index];
		tourCount.textContent = "Stop " + (tour.index + 1) + " of " + TOUR_STOPS.length;
		tourName.textContent = s.name;
		tourPrev.disabled = tour.index === 0;
		tourNext.disabled = tour.index === TOUR_STOPS.length - 1;
		tourAuto.setAttribute("aria-pressed", tour.auto ? "true" : "false");
		tourAuto.textContent = tour.auto ? "Pause" : "Auto-play";
	}

	/* Glide to a stop along the ring rather than straight through the
	 * middle of the campus. The mid control point is pushed outward from
	 * the campus centre, which is what bends the path around the buildings
	 * instead of through them. */
	function tourGoTo(index, immediate) {
		if (index < 0 || index >= TOUR_STOPS.length) return;
		tour.index = index;
		tour.autoT = 0;
		var s = TOUR_STOPS[index];

		if (immediate) {
			tour.glide = null;
			camera.position.copy(s.pos);
			orbit.target.copy(s.look);
			orbit.update();
		} else {
			var from = camera.position.clone();
			var mid = from.clone().add(s.pos).multiplyScalar(0.5);
			var out = new THREE.Vector2(mid.x, mid.z);
			if (out.lengthSq() > 1) {
				/* push the midpoint out to roughly the ring radius */
				out.normalize().multiplyScalar(Math.max(out.length(), 96));
				mid.x = out.x; mid.z = out.y;
			}
			mid.y = EYE;
			tour.glide = {
				t: 0,
				dur: Math.max(2.2, Math.min(6.0, from.distanceTo(s.pos) / 34)),
				curve: new THREE.CatmullRomCurve3([from, mid, s.pos], false, "catmullrom", 0.3),
				fromLook: orbit.target.clone(),
				toLook: s.look.clone()
			};
		}

		if (s.building) openInfo(s.building, null);
		else if (infoEl) infoEl.hidden = true;
		tourSyncUi();
	}

	function enterTour() {
		if (intro.active) endIntro(true);
		walkControls.unlock();
		/* Eye-height orbiting needs to get much closer than the default
		 * 28 m floor, or the camera cannot stand in front of a building.
		 * maxPolarAngle has to open up too: standing at 1.7 m and looking
		 * at a point 8 m up puts the camera BELOW its target, which the
		 * default 0.49pi limit forbids - it silently lifted the camera to
		 * 7.5 m to satisfy the constraint. */
		orbit.minDistance = 6;
		orbit.maxPolarAngle = Math.PI * 0.98;
		orbit.enabled = true;
		if (tourEl) tourEl.hidden = false;
		tourGoTo(0, true);
	}
	function exitTour() {
		tour.glide = null;
		tour.auto = false;
		orbit.minDistance = 28;
		orbit.maxPolarAngle = Math.PI * 0.49;
		if (tourEl) tourEl.hidden = true;
	}

	if (tourPrev) tourPrev.addEventListener("click", function () { tour.auto = false; tourGoTo(tour.index - 1); });
	if (tourNext) tourNext.addEventListener("click", function () { tour.auto = false; tourGoTo(tour.index + 1); });
	if (tourAuto) tourAuto.addEventListener("click", function () {
		tour.auto = !tour.auto;
		tour.autoT = 0;
		tourSyncUi();
	});
	if (tourExit) tourExit.addEventListener("click", function () { setMode("orbit"); });

	/* Console probe, same spirit as HKBKTrace: the tour is the one feature
	 * whose correctness is "did the camera stay on the ground and actually
	 * travel", and there is no headless WebGL here to check that visually. */
	window.HKBKTour = function () {
		return {
			stop: TOUR_STOPS[tour.index].name,
			index: tour.index,
			of: TOUR_STOPS.length,
			gliding: !!tour.glide,
			auto: tour.auto,
			camera: { x: +camera.position.x.toFixed(1), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(1) }
		};
	};

	document.addEventListener("keydown", function (e) {
		if (mode !== "tour") return;
		if (e.code === "ArrowRight") { tour.auto = false; tourGoTo(tour.index + 1); }
		if (e.code === "ArrowLeft") { tour.auto = false; tourGoTo(tour.index - 1); }
	});

	/* Dragging to look around cancels auto-play - otherwise the camera
	 * walks off mid-look, which feels like the page fighting you. */
	orbit.addEventListener("start", function () {
		if (mode === "tour" && tour.auto) { tour.auto = false; tourSyncUi(); }
	});

	/* ---- resize / visibility ---- */
	window.addEventListener("resize", function () {
		var w = window.innerWidth, h = window.innerHeight;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		if (ssaoPass) ssaoPass.setSize(w, h);
		bloomPass.setSize(w, h);
	});

	var running = true;
	document.addEventListener("visibilitychange", function () {
		running = !document.hidden;
		if (running && !raf) { clock = new THREE.Clock(); raf = requestAnimationFrame(tick); }
	});

	/* ---- main loop ---- */
	var CYCLE = 70;
	var sunDay = new THREE.Color(0xfff4e0), sunNight = new THREE.Color(0x2c3a55);
	var winDay = new THREE.Color(0x9fb8c8), winNight = new THREE.Color(0x8fd4ff);
	var clock = new THREE.Clock();
	var raf = null;
	var revealT = 0;

	function tick() {
		if (!running) { raf = null; return; }
		raf = requestAnimationFrame(tick);
		var dt = Math.min(0.05, clock.getDelta());
		var t = clock.getElapsedTime();

		var night = Math.sin((t / CYCLE) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;

		/* "Sunlight gradually reveals the campus": exposure opens from
		 * near-black over the first few seconds rather than the page
		 * cutting to a fully lit frame. Held down until the environment map
		 * has actually finished decoding, so the reveal never lands on
		 * unlit materials. */
		if (envReady) revealT = Math.min(1, revealT + dt / 4.2);
		var reveal = revealT;
		var revealEase = 1 - Math.pow(1 - reveal, 2.4);
		renderer.toneMappingExposure = (0.12 + revealEase * 0.93) * (1.0 - night * 0.42);

		scene.background.lerpColors(dayColor, nightColor, night);
		scene.fog.color.copy(scene.background);
		sun.color.lerpColors(sunDay, sunNight, night);
		sun.intensity = 2.4 - night * 1.6;
		rim.intensity = 0.5 + night * 1.1;
		windowMats.forEach(function (m) {
			m.color.lerpColors(winDay, winNight, night);
			m.emissive.copy(m.color);
			m.emissiveIntensity = 0.15 + night * 1.2;
		});

		if (mode === "walk") {
			var speed = 6.5 * dt;
			walkVelocity.set(0, 0, 0);
			if (walkKeys.w) walkVelocity.z -= 1;
			if (walkKeys.s) walkVelocity.z += 1;
			if (walkKeys.a) walkVelocity.x -= 1;
			if (walkKeys.d) walkVelocity.x += 1;
			if (walkVelocity.lengthSq() > 0) {
				walkVelocity.normalize().multiplyScalar(speed);
				walkControls.moveRight(walkVelocity.x);
				walkControls.moveForward(-walkVelocity.z);
				camera.position.y = 1.7; /* flat ground, no collision - documented limitation */
			}
		} else if (intro.active) {
			intro.t += dt / INTRO_DURATION;
			var ip = Math.min(1, intro.t);

			/* Two-stage easing: a long, almost-linear glide, then a firm
			 * settle. A single easeInOut over 15s reads as sluggish at the
			 * start and abrupt at the end. */
			var glide = ip < 0.72
				? (ip / 0.72) * 0.78
				: 0.78 + (1 - Math.pow(1 - (ip - 0.72) / 0.28, 3)) * 0.22;

			camera.position.copy(introPath.getPoint(glide));
			var look = introLook.getPoint(glide);
			camera.lookAt(look);

			/* Bank: peaks through the turn (roughly 35-75% of the move) and
			 * unwinds to level before handover, so the horizon is straight
			 * the moment the user gets control. */
			var bankWindow = Math.sin(Math.max(0, Math.min(1, (glide - 0.3) / 0.5)) * Math.PI);
			camera.rotateZ(bankWindow * 0.115);

			if (introBrand && ip > 0.78 && !introBrand.classList.contains("is-visible")) {
				introBrand.classList.add("is-visible");
			}
			if (introOverlay && ip > 0.05) introOverlay.classList.add("is-clear");

			if (ip >= 1) endIntro(false);
		} else if (mode === "tour") {
			if (tour.glide) {
				tour.glide.t += dt / tour.glide.dur;
				var gp = Math.min(1, tour.glide.t);
				/* easeInOutCubic: the walk starts and ends at a standstill,
				 * which is what stops it reading as a dolly on rails. */
				var ge = gp < 0.5 ? 4 * gp * gp * gp : 1 - Math.pow(-2 * gp + 2, 3) / 2;
				camera.position.copy(tour.glide.curve.getPoint(ge));
				camera.position.y = EYE;   /* stay on the ground the whole way */
				orbit.target.lerpVectors(tour.glide.fromLook, tour.glide.toLook, ge);
				/* Drive the camera directly while gliding. orbit.update()
				 * recomputes position from its own spherical state, so
				 * calling it here would overwrite the scripted move and the
				 * camera would sit still - same reason the intro uses
				 * lookAt() instead of the controls. */
				camera.lookAt(orbit.target);
				if (gp >= 1) {
					tour.glide = null;
					/* Hand back to the controls: one update resyncs their
					 * spherical state to where the glide actually left the
					 * camera, so the first drag does not snap. */
					orbit.update();
				}
			} else {
				if (tour.auto) {
					tour.autoT += dt;
					if (tour.autoT >= AUTO_HOLD) {
						if (tour.index < TOUR_STOPS.length - 1) {
							tourGoTo(tour.index + 1);
						} else {
							tour.auto = false;
							tourSyncUi();
						}
					}
				}
				orbit.update();
				/* Free look must not walk the camera into the ground. */
				if (camera.position.y < EYE) camera.position.y = EYE;
			}
		} else {
			if (tween) {
				tween.t += dt / tween.dur;
				var p = Math.min(1, tween.t);
				var ease = tween.ease(p);
				camera.position.lerpVectors(tween.fromPos, tween.toPos, ease);
				orbit.target.lerpVectors(tween.fromTarget, tween.toTarget, ease);
				/* Lens change is part of the shot, not decoration - a move
				 * that also goes from 55 to 34 degrees compresses as it
				 * arrives, which is what makes it read as a different shot
				 * rather than the same shot from closer up. */
				if (tween.fromFov !== tween.toFov) {
					camera.fov = tween.fromFov + (tween.toFov - tween.fromFov) * ease;
					camera.updateProjectionMatrix();
				}
				if (p >= 1) tween = null;
			}
			/* Breathing idle. The offset has to be removed before
			 * orbit.update() and re-applied after it: OrbitControls derives
			 * its spherical state from camera.position every frame, so an
			 * offset left in place would be read back as user rotation and
			 * the camera would slowly wander off. */
			camera.position.sub(breathOffset);
			orbit.update();

			var idleFor = performance.now() - lastUserInput;
			var breathAmt = (!tween && idleFor > 2500)
				? Math.min(1, (idleFor - 2500) / 2000)
				: 0;
			breathOffset.set(
				Math.sin(t * 0.29 + 1.3) * 0.34,
				Math.sin(t * 0.42) * 0.42,
				Math.cos(t * 0.24) * 0.34
			).multiplyScalar(breathAmt);
			camera.position.add(breathOffset);
		}

		/* Highlight state, resolved to an absolute value every frame.
		 *
		 * (The previous version did `emissiveIntensity += pulse` with no
		 * restore, so intensity ratcheted upward for as long as the page
		 * was open and every building eventually blew out to white. Base
		 * values are cached on first touch and written absolutely now.) */
		var now = performance.now();
		Object.keys(buildingMeshes).forEach(function (id) {
			var until = highlightUntil[id];
			var focusPulse = (until && now < until) ? 0.35 + Math.sin(now * 0.012) * 0.25 : 0;

			var hoverTarget = (hoveredId === id) ? 1 : 0;
			hoverAmt[id] = (hoverAmt[id] || 0) + (hoverTarget - (hoverAmt[id] || 0)) * Math.min(1, dt * 9);
			var boost = Math.max(focusPulse, hoverAmt[id] * 0.42);

			buildingMeshes[id].traverse(function (n) {
				if (!n.isMesh || !n.material || !n.material.emissive) return;
				if (n.userData.baseEmissive === undefined) {
					n.userData.baseEmissive = n.material.emissiveIntensity || 0;
				}
				n.material.emissiveIntensity = n.userData.baseEmissive + boost;
			});
		});

		resolveHover();

		labels.forEach(function (l) {
			l.sprite.visible = labelsOn && !intro.active;
			var h = hoverAmt[l.building.id] || 0;
			l.sprite.material.opacity = 0.62 + h * 0.38;
			var s = 1 + h * 0.08;
			l.sprite.scale.set(25 * s, 6.2 * s, 1);
		});

		if (bootEl && !bootEl.hidden) bootEl.hidden = true;
		/* HUD stays out of frame for the duration of the intro - endIntro()
		 * reveals it. Chrome during a title sequence is the single clearest
		 * "student project" tell. */
		if (!intro.active && hudEl.hidden) { hudEl.hidden = false; guideEl.hidden = false; }

		composer.render();
	}

	var labelsOn = true;
	document.getElementById("campus-labels-toggle").addEventListener("change", function (e) {
		labelsOn = e.target.checked;
	});

	tick();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", boot);
} else {
	boot();
}
