/*
 * Street View walkthrough
 * ========================
 *
 * A real-photo sequence viewer. The legacy page uses the default dataset
 * below; independent walkthroughs can provide data-manifest and
 * data-image-base on #sv-root without changing the old page.
 */
(function () {
	"use strict";

	var root = document.getElementById("sv-root");
	if (!root) return;

	var startScreen = document.getElementById("sv-start");
	var startBtn = document.getElementById("sv-start-btn");
	var stage = document.getElementById("sv-stage");
	var loadingEl = document.getElementById("sv-loading");
	var photoEl = document.getElementById("sv-photo");
	var photoPrevEl = document.getElementById("sv-photo-prev");
	var hitBack = document.getElementById("sv-hit-back");
	var hitFwd = document.getElementById("sv-hit-fwd");
	var btnBack = document.getElementById("sv-back");
	var btnFwd = document.getElementById("sv-fwd");
	var restartBtn = document.getElementById("sv-restart");
	var endState = document.getElementById("sv-end");
	var endRestartBtn = document.getElementById("sv-end-restart");
	var chapterLabel = document.getElementById("sv-chapter-label");
	var progressEl = document.getElementById("sv-progress");
	var trackFill = document.getElementById("sv-trackbar-fill");
	var trackTicks = document.getElementById("sv-trackbar-ticks");
	var chapterSelect = document.getElementById("sv-chapter-select");
	var sourceEl = document.getElementById("sv-source");
	var sampleTimeEl = document.getElementById("sv-sample-time");
	var clipEl = document.getElementById("sv-clip");
	var boundaryEl = document.getElementById("sv-clip-boundary");
	var boundaryTextEl = document.getElementById("sv-clip-boundary-text");

	var manifestUrl = root.getAttribute("data-manifest") || "assets/tour-photos/manifest.json";
	var imageBase = root.getAttribute("data-image-base") || "assets/tour-photos/";
	if (imageBase.charAt(imageBase.length - 1) !== "/") imageBase += "/";
	var datasetName = root.getAttribute("data-dataset") || manifestUrl;
	var hardCutAcrossClips = root.getAttribute("data-hard-cut") === "clips";
	var manifest = null;
	var index = 0;
	var loaded = {};
	var renderToken = 0;
	var currentRenderedIndex = null;
	var imageReady = false;
	var lastError = null;
	var touchX = null;

	function frameUrl(frame) {
		return imageBase + frame.file;
	}

	function startIndexFromQuery() {
		var raw = new URLSearchParams(window.location.search).get("start");
		if (raw === null || !/^\d+$/.test(raw)) return 0;

		var frameNo = Number(raw);
		if (!Number.isFinite(frameNo)) return 0;
		frameNo = Math.max(1, Math.min(manifest.frames.length, frameNo));
		return frameNo - 1;
	}

	function chapterFor(i) {
		if (!manifest || !Array.isArray(manifest.chapters)) return null;
		var frameNo = i + 1;
		for (var c = 0; c < manifest.chapters.length; c++) {
			var chapter = manifest.chapters[c];
			if (frameNo >= chapter.start && frameNo <= chapter.end) return chapter;
		}
		return null;
	}

	function clipFor(frame) {
		if (!manifest || !frame) return null;
		var clips = Array.isArray(manifest.clips) ? manifest.clips : [];
		for (var c = 0; c < clips.length; c++) {
			if (clips[c].filename === frame.clip) return clips[c];
		}
		return null;
	}

	function clipNumberFor(frame) {
		var clips = manifest && Array.isArray(manifest.clips) ? manifest.clips : [];
		for (var c = 0; c < clips.length; c++) {
			if (clips[c].filename === frame.clip) return c + 1;
		}
		/* Keep the provenance useful if a producer supplies frames before the
		 * optional clips index is available. */
		var seen = [];
		for (var i = 0; i <= index; i++) {
			var name = manifest.frames[i].clip;
			if (seen.indexOf(name) === -1) seen.push(name);
		}
		return seen.indexOf(frame.clip) + 1;
	}

	function setLoading(message, visible) {
		if (!loadingEl) return;
		if (message) loadingEl.textContent = message;
		loadingEl.hidden = !visible;
	}

	function setNavigationEnabled(enabled) {
		if (btnBack) btnBack.disabled = !enabled || index === 0;
		if (btnFwd) btnFwd.disabled = !enabled || index === manifest.frames.length - 1;
	}

	function preload(i) {
		if (!manifest || i < 0 || i >= manifest.frames.length || loaded[i]) return;
		var img = new Image();
		img.onload = function () { loaded[i] = true; };
		img.src = frameUrl(manifest.frames[i]);
	}

	function updateProvenance(frame) {
		var clip = clipFor(frame);
		var clipCount = manifest && Array.isArray(manifest.clips) ? manifest.clips.length : 0;
		var clipNumber = clipNumberFor(frame);
		var isBoundary = frame.clip_start === true || frame.clip_start === 1 || frame.clip_start === "true";

		if (sourceEl) sourceEl.textContent = "Source MOV: " + (frame.clip || "not recorded");
		if (sampleTimeEl) {
			var sampleTime = typeof frame.t === "number" ? frame.t.toFixed(2) : String(frame.t || "—");
			sampleTimeEl.textContent = "Sample t ≈ " + sampleTime + " s (approx.)";
		}
		if (clipEl) {
			clipEl.textContent = "Clip " + clipNumber + "/" + (clipCount || "—");
			if (clip && typeof clip.duration_seconds === "number") {
				clipEl.textContent += " · " + clip.duration_seconds.toFixed(1) + " s";
			}
		}
		if (boundaryEl) boundaryEl.hidden = !isBoundary;
		if (boundaryTextEl && isBoundary) {
			boundaryTextEl.textContent = clip && clip.boundary_note
				? clip.boundary_note
				: "Clip boundary — hard cut; this is not a continuous take.";
		}
	}

	function commitImage(targetIndex, url, token) {
		if (token !== renderToken || targetIndex !== index) return;

		var previousFrame = currentRenderedIndex === null ? null : manifest.frames[currentRenderedIndex];
		var targetFrame = manifest.frames[targetIndex];
		var clipChanged = previousFrame && previousFrame.clip !== targetFrame.clip;
		var hardCut = hardCutAcrossClips && clipChanged;

		if (hardCut) {
			photoPrevEl.classList.remove("is-visible");
			photoEl.classList.remove("is-visible");
			photoEl.src = url;
			photoEl.classList.add("is-visible");
		} else {
			if (photoEl.src && photoEl.classList.contains("is-visible")) {
				photoPrevEl.src = photoEl.src;
				photoPrevEl.classList.add("is-visible");
			}
			photoEl.src = url;
			photoEl.classList.add("is-visible");
			window.setTimeout(function () {
				if (token === renderToken) photoPrevEl.classList.remove("is-visible");
			}, 240);
		}

		loaded[targetIndex] = true;
		currentRenderedIndex = targetIndex;
		imageReady = true;
		lastError = null;
		setLoading("", false);
		setNavigationEnabled(true);
		endState.hidden = index !== manifest.frames.length - 1;
	}

	function render() {
		if (!manifest) return;
		var targetIndex = index;
		var frame = manifest.frames[targetIndex];
		var url = frameUrl(frame);
		var token = ++renderToken;
		imageReady = false;
		lastError = null;
		setNavigationEnabled(false);

		if (chapterLabel) {
			var chapter = chapterFor(targetIndex);
			chapterLabel.textContent = chapter ? chapter.label : "";
			if (chapterSelect && chapter) chapterSelect.value = String(Math.max(0, chapter.start - 1));
		}
		if (progressEl) progressEl.textContent = "Step " + (targetIndex + 1) + " of " + manifest.frames.length;
		if (photoEl) photoEl.alt = "Walkthrough photo " + (targetIndex + 1) + " of " + manifest.frames.length;
		if (trackFill) {
			var pct = manifest.frames.length > 1 ? (targetIndex / (manifest.frames.length - 1)) * 100 : 0;
			trackFill.style.width = pct + "%";
		}
		if (endState) endState.hidden = true;
		updateProvenance(frame);

		if (loaded[targetIndex]) {
			commitImage(targetIndex, url, token);
		} else {
			if (currentRenderedIndex === null) setLoading("Loading frame…", true);
			var img = new Image();
			img.onload = function () { commitImage(targetIndex, url, token); };
			img.onerror = function () {
				if (token !== renderToken || targetIndex !== index) return;
				imageReady = false;
				lastError = "Could not load " + frame.file;
				setNavigationEnabled(false);
				setLoading(lastError + ". Check " + imageBase, true);
			};
			img.src = url;
		}

		preload(targetIndex + 1);
		preload(targetIndex + 2);
		preload(targetIndex - 1);
	}

	function step(delta) {
		if (!manifest || !imageReady) return;
		var next = index + delta;
		if (next < 0 || next >= manifest.frames.length) return;
		index = next;
		render();
	}

	function drawTicks() {
		if (!trackTicks) return;
		trackTicks.innerHTML = "";
		if (!manifest || manifest.frames.length < 2) return;
		var ticks = [];
		(Array.isArray(manifest.chapters) ? manifest.chapters : []).forEach(function (chapter) {
			if (chapter.start !== 1) ticks.push({ frame: chapter.start, type: "chapter" });
		});
		if (hardCutAcrossClips) {
			manifest.frames.forEach(function (frame, frameIndex) {
				if (frameIndex > 0 && (frame.clip_start === true || frame.clip_start === 1 || frame.clip_start === "true")) {
					ticks.push({ frame: frameIndex + 1, type: "clip" });
				}
			});
		}
		ticks.forEach(function (tickInfo) {
			var pct = ((tickInfo.frame - 1) / (manifest.frames.length - 1)) * 100;
			var tick = document.createElement("span");
			tick.className = "sv-trackbar__tick--" + tickInfo.type;
			tick.style.left = pct + "%";
			trackTicks.appendChild(tick);
		});
	}

	function buildChapterChoice() {
		if (!chapterSelect || !manifest || !Array.isArray(manifest.chapters)) return;
		chapterSelect.innerHTML = "";
		manifest.chapters.forEach(function (chapter, chapterIndex) {
			var option = document.createElement("option");
			option.value = String(Math.max(0, chapter.start - 1));
			option.textContent = (chapterIndex + 1) + ". " + chapter.label;
			chapterSelect.appendChild(option);
		});
		chapterSelect.disabled = false;
	}

	function begin(startIndex) {
		if (!manifest) return;
		startScreen.hidden = true;
		stage.hidden = false;
		index = typeof startIndex === "number" ? startIndex : startIndexFromQuery();
		index = Math.max(0, Math.min(manifest.frames.length - 1, index));
		drawTicks();
		render();
	}

	function restart() {
		if (!manifest || !imageReady) return;
		index = 0;
		render();
	}

	if (startBtn) startBtn.disabled = true;
	if (chapterSelect) chapterSelect.disabled = true;
	if (loadingEl) loadingEl.hidden = false;

	if (startBtn) startBtn.addEventListener("click", begin);
	if (restartBtn) restartBtn.addEventListener("click", restart);
	if (endRestartBtn) endRestartBtn.addEventListener("click", restart);
	if (chapterSelect) chapterSelect.addEventListener("change", function () {
		var chosen = Number(chapterSelect.value);
		if (!Number.isFinite(chosen)) return;
		if (stage.hidden) begin(chosen);
		else if (imageReady) { index = chosen; render(); }
	});
	if (hitFwd) hitFwd.addEventListener("click", function () { step(1); });
	if (hitBack) hitBack.addEventListener("click", function () { step(-1); });
	if (btnFwd) btnFwd.addEventListener("click", function (e) { e.stopPropagation(); step(1); });
	if (btnBack) btnBack.addEventListener("click", function (e) { e.stopPropagation(); step(-1); });

	document.addEventListener("keydown", function (e) {
		if (stage.hidden) return;
		if (e.code === "ArrowRight") step(1);
		if (e.code === "ArrowLeft") step(-1);
	});

	root.addEventListener("touchstart", function (e) {
		if (stage.hidden || !imageReady) return;
		touchX = e.touches[0].clientX;
	}, { passive: true });
	root.addEventListener("touchend", function (e) {
		if (stage.hidden || !imageReady || touchX === null) return;
		var dx = e.changedTouches[0].clientX - touchX;
		touchX = null;
		if (Math.abs(dx) < 40) return;
		step(dx < 0 ? 1 : -1);
	}, { passive: true });

	fetch(manifestUrl)
		.then(function (response) {
			if (!response.ok) throw new Error("manifest fetch failed: " + response.status);
			return response.json();
		})
		.then(function (data) {
			if (!data || !Array.isArray(data.frames) || !data.frames.length) {
				throw new Error("manifest has no frames");
			}
			manifest = data;
			lastError = null;
			if (startBtn) startBtn.disabled = false;
			buildChapterChoice();
			setLoading("", false);
			preload(0);
			preload(1);
		})
		.catch(function (err) {
			lastError = err.message;
			if (startBtn) startBtn.disabled = true;
			setLoading("Could not load the walkthrough dataset (" + err.message + "). Check " + manifestUrl + ".", true);
			console.error("[street-view]", err);
		});

	/* Console probe. The original fields remain available; the optional
	 * provenance fields are null/false until a frame is active. */
	window.HKBKStreetView = function () {
		var frame = manifest && manifest.frames[index];
		var clip = frame && clipFor(frame);
		var isBoundary = !!(frame && (frame.clip_start === true || frame.clip_start === 1 || frame.clip_start === "true"));
		return {
			ready: !!manifest,
			error: lastError,
			active: !!(stage && !stage.hidden),
			source: frame ? frame.clip || null : null,
			t: frame && typeof frame.t === "number" ? frame.t : null,
			boundary: isBoundary,
			dataset: datasetName,
			index: manifest ? index : 0,
			of: manifest ? manifest.frames.length : 0,
			chapter: chapterFor(index) && chapterFor(index).label,
			frameFile: frame ? frame.file : null,
			clip: clip || null
		};
	};
}());
