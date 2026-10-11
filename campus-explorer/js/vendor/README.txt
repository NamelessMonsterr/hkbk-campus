Three.js r140 (npm package three@0.140.0), global/UMD build (build/three.min.js).

Pulled via `npm pack three@0.140.0` and extracted, then copied to three.min.js in
this folder unmodified. Chosen over newer releases because Three.js dropped the
global/UMD build after r160 (ES modules only from ~0.165.0 onward), and r140 predates
the r150+ deprecation console.warn that newer global builds print on load - r140
loads silently, matching this project's zero-console-noise requirement for a
file://-opened page.

Defines window.THREE. Loaded as a plain <script> tag (not type="module") because
file:// blocks ES module script loading when the page is opened by double-click
rather than served, and this project has no build step.

No network calls at runtime - this file is loaded from disk only.
