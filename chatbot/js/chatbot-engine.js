/*!
 * HKBK College Enquiry Chatbot - retrieval engine
 * ------------------------------------------------
 * A browser-only, zero-dependency implementation of the pipeline described in
 * "Intelligent Chatbot For College Inquiry And Support: Using Fuzzy Matching
 * And LLM" (Dept. of CSE, HKBK College of Engineering, 2025).
 *
 * Pipeline, in order:
 *   1. Language identification (Unicode script detection)
 *   2. Normalisation and tokenisation
 *   3. Fuzzy repair of out-of-vocabulary tokens (Levenshtein ratio >= 0.78)
 *   4. Whole-question fuzzy match against stored question variants (>= 0.78)
 *   5. TF-IDF vector-space retrieval over a chunked knowledge base,
 *      cosine similarity, top-5 nearest chunks
 *   6. Confidence floor -> explicit out-of-scope reply with human handoff
 *   7. Conflict routing -> contested figures answered as a sourced range
 *   8. Ten-turn memory buffer, discarded when the session ends
 *
 * Honest deviations from the paper are listed in docs/implementation-notes.md.
 * The most important one: there is no LLM and no VectorShift call here. This
 * runs offline. The LLM is a documented, swappable hook (see setLlmHook).
 */
(function (global) {
	"use strict";

	var CONFIG = {
		fuzzyThreshold: 0.78,   // paper's Levenshtein similarity cut-off
		topK: 5,                // paper retrieves the 5 nearest chunks
		chunkSize: 512,         // paper's chunk width, measured here in word tokens
		chunkOverlap: 64,       // paper's overlap
		memoryTurns: 10,        // paper's conversation buffer depth
		confidenceFloor: 0.17,  // NOT in the paper - see docs. This is the gap the
		                        // paper admits it never implemented.
		strongMatch: 0.55,      // above this we answer without hedging
		maxFuzzyLen: 60         // don't Levenshtein whole paragraphs
	};

	/* ----------------------------------------------------------------
	 * 1. Language identification
	 * ---------------------------------------------------------------- */

	var SCRIPTS = [
		{ lang: "kn", re: /[\u0C80-\u0CFF]/ },  // Kannada
		{ lang: "hi", re: /[\u0900-\u097F]/ },  // Devanagari
		{ lang: "ur", re: /[\u0600-\u06FF]/ }   // Arabic script, used for Urdu
	];

	// Script detection only. A romanised Kannada query ("hostel fee eshtu")
	// is detected as English - a real limitation, documented rather than hidden.
	function detectLanguage(text, available) {
		for (var i = 0; i < SCRIPTS.length; i++) {
			if (SCRIPTS[i].re.test(text)) {
				if (!available || available.indexOf(SCRIPTS[i].lang) !== -1) {
					return SCRIPTS[i].lang;
				}
			}
		}
		return "en";
	}

	/* ----------------------------------------------------------------
	 * 2. Normalisation and tokenisation
	 * ---------------------------------------------------------------- */

	var STOPWORDS = {
		en: ("a an the is are was were be been being do does did of for to in on at" +
			" by with from about into it its this that these those i me my we our you" +
			" your and or but if then so as what which who whom how when where why" +
			" can could will would shall should may might must there here have has had" +
			" get got tell give please kindly want need know").split(" ")
	};

	var STOPSET = {};
	(function () {
		for (var lang in STOPWORDS) {
			if (!Object.prototype.hasOwnProperty.call(STOPWORDS, lang)) continue;
			STOPSET[lang] = Object.create(null);
			for (var i = 0; i < STOPWORDS[lang].length; i++) {
				STOPSET[lang][STOPWORDS[lang][i]] = true;
			}
		}
	}());

	function normalise(text) {
		var t = String(text == null ? "" : text).toLowerCase();
		// strip zero-width joiners that Indic keyboards emit freely
		t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
		return t.replace(/\s+/g, " ").trim();
	}

	// Answers in the knowledge base carry {{TOKEN}} placeholders for figures that
	// change yearly (fees, packages, deadlines). Values live in meta.tokens with
	// a provenance record beside them, so a figure is updated in exactly one
	// place. Anything left unresolved is reported rather than shown silently.
	var TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;

	// A token value is either a plain string or a per-language object such as
	// { en: "Rs 1,00,000 per year", kn: "..." }. Without this, a Kannada answer
	// ends up with an English figure spliced into the middle of it.
	function resolveTokens(text, tokens, lang) {
		if (text == null) return { text: "", unresolved: [] };
		var unresolved = [];
		var map = tokens || {};
		var out = String(text).replace(TOKEN_RE, function (match, key) {
			if (!Object.prototype.hasOwnProperty.call(map, key)) {
				unresolved.push(key);
				return match;
			}
			var val = map[key];
			if (val && typeof val === "object") val = val[lang] || val.en;
			if (val) return val;
			unresolved.push(key);
			return match;
		});
		return { text: out, unresolved: unresolved };
	}

	var WORD_RE = /[\p{L}\p{N}]+/gu;

	function tokenise(text, lang) {
		var raw = normalise(text).match(WORD_RE) || [];
		var stop = STOPSET[lang] || STOPSET.en;
		var out = [];
		for (var i = 0; i < raw.length; i++) {
			var w = raw[i];
			// keep short tokens only if they are numeric (fees, years, ranks)
			if (w.length < 2 && !/^\d+$/.test(w)) continue;
			if (stop[w]) continue;
			out.push(w);
		}
		return out;
	}

	/* ----------------------------------------------------------------
	 * 3. Levenshtein distance and similarity ratio
	 * ---------------------------------------------------------------- */

	// Two-row dynamic programming. O(len(a) * len(b)) time, O(len(b)) space.
	function levenshtein(a, b) {
		if (a === b) return 0;
		if (!a.length) return b.length;
		if (!b.length) return a.length;

		var prev = new Array(b.length + 1);
		var curr = new Array(b.length + 1);
		var i, j;

		for (j = 0; j <= b.length; j++) prev[j] = j;

		for (i = 1; i <= a.length; i++) {
			curr[0] = i;
			var ca = a.charCodeAt(i - 1);
			for (j = 1; j <= b.length; j++) {
				var cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
				var del = prev[j] + 1;
				var ins = curr[j - 1] + 1;
				var sub = prev[j - 1] + cost;
				curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
			}
			for (j = 0; j <= b.length; j++) prev[j] = curr[j];
		}
		return prev[b.length];
	}

	// Normalised similarity in [0,1]. This is the quantity compared against 0.78.
	function similarity(a, b) {
		if (!a.length && !b.length) return 1;
		var max = a.length > b.length ? a.length : b.length;
		if (max > CONFIG.maxFuzzyLen) return 0;
		return 1 - (levenshtein(a, b) / max);
	}

	/* ----------------------------------------------------------------
	 * 4. Chunking
	 * ---------------------------------------------------------------- */

	// Sliding window over word tokens. The paper uses 512-token chunks with 64
	// overlap on a BPE tokeniser; word tokens are a coarser proxy. Most KB
	// answers are far shorter than 512 words, so in practice one chunk per
	// answer - the machinery matters only for the longer entries.
	function chunk(words, size, overlap) {
		if (words.length <= size) return [words];
		var step = size - overlap;
		if (step < 1) step = 1;
		var out = [];
		for (var start = 0; start < words.length; start += step) {
			out.push(words.slice(start, start + size));
			if (start + size >= words.length) break;
		}
		return out;
	}

	/* ----------------------------------------------------------------
	 * 5. TF-IDF index
	 * ---------------------------------------------------------------- */

	function Index(kb) {
		this.kb = kb;
		this.docs = [];          // one per (entry, language, chunk)
		this.df = Object.create(null);
		this.vocab = Object.create(null);
		this.byLang = Object.create(null);
		this.entryById = Object.create(null);
		this.build();
	}

	Index.prototype.build = function () {
		var entries = (this.kb && this.kb.entries) || [];
		var langs = (this.kb.meta && this.kb.meta.languages) || ["en"];

		for (var e = 0; e < entries.length; e++) {
			var entry = entries[e];
			this.entryById[entry.id] = entry;

			for (var l = 0; l < langs.length; l++) {
				var lang = langs[l];
				var block = entry[lang];
				if (!block || !block.a) continue;

				// A retrieval document is: question variants + tags + answer.
				// Question variants are what users actually type, so they carry
				// the most signal; they are repeated to weight them higher.
				var variants = (block.q || []).join(" ");
				var tags = (entry.tags || []).join(" ");
				var surface = variants + " " + variants + " " + tags + " " + block.a;
				var words = tokenise(surface, lang);
				var chunks = chunk(words, CONFIG.chunkSize, CONFIG.chunkOverlap);

				for (var c = 0; c < chunks.length; c++) {
					var tf = Object.create(null);
					var cw = chunks[c];
					for (var w = 0; w < cw.length; w++) {
						tf[cw[w]] = (tf[cw[w]] || 0) + 1;
						this.vocab[cw[w]] = true;
					}
					for (var term in tf) {
						if (!Object.prototype.hasOwnProperty.call(tf, term)) continue;
						this.df[term] = (this.df[term] || 0) + 1;
					}
					var doc = {
						id: this.docs.length,
						entryId: entry.id,
						category: entry.category,
						lang: lang,
						chunkIndex: c,
						chunkCount: chunks.length,
						tf: tf,
						length: cw.length,
						vec: null,
						norm: 0
					};
					this.docs.push(doc);
					(this.byLang[lang] || (this.byLang[lang] = [])).push(doc);
				}
			}
		}

		// Second pass: idf is only knowable once every chunk is counted.
		var N = this.docs.length || 1;
		this.idf = Object.create(null);
		for (var t in this.df) {
			if (!Object.prototype.hasOwnProperty.call(this.df, t)) continue;
			this.idf[t] = Math.log(1 + (N / this.df[t]));
		}
		for (var d = 0; d < this.docs.length; d++) {
			this.vectorise(this.docs[d]);
		}
		this.vocabList = Object.keys(this.vocab);
	};

	Index.prototype.vectorise = function (doc) {
		var vec = Object.create(null);
		var sum = 0;
		for (var term in doc.tf) {
			if (!Object.prototype.hasOwnProperty.call(doc.tf, term)) continue;
			// sublinear tf damps repeated words; idf rewards distinctive ones
			var weight = (1 + Math.log(doc.tf[term])) * (this.idf[term] || 0);
			vec[term] = weight;
			sum += weight * weight;
		}
		doc.vec = vec;
		doc.norm = Math.sqrt(sum) || 1;
	};

	Index.prototype.queryVector = function (tokens) {
		var tf = Object.create(null);
		for (var i = 0; i < tokens.length; i++) {
			tf[tokens[i]] = (tf[tokens[i]] || 0) + 1;
		}
		var vec = Object.create(null);
		var sum = 0;
		for (var term in tf) {
			if (!Object.prototype.hasOwnProperty.call(tf, term)) continue;
			var weight = (1 + Math.log(tf[term])) * (this.idf[term] || 0);
			if (!weight) continue;
			vec[term] = weight;
			sum += weight * weight;
		}
		return { vec: vec, norm: Math.sqrt(sum) || 1 };
	};

	function cosine(qv, doc) {
		var dot = 0;
		// iterate the shorter side: the query
		for (var term in qv.vec) {
			if (!Object.prototype.hasOwnProperty.call(qv.vec, term)) continue;
			var dw = doc.vec[term];
			if (dw) dot += qv.vec[term] * dw;
		}
		if (!dot) return 0;
		return dot / (qv.norm * doc.norm);
	}

	// Retrieve the top-K nearest chunks in the requested language, falling back
	// to English when a language has no coverage for anything.
	Index.prototype.search = function (tokens, lang, k) {
		var pool = this.byLang[lang];
		var usedLang = lang;
		if (!pool || !pool.length) { pool = this.byLang.en || []; usedLang = "en"; }

		var qv = this.queryVector(tokens);
		var scored = [];
		for (var i = 0; i < pool.length; i++) {
			var s = cosine(qv, pool[i]);
			if (s > 0) scored.push({ doc: pool[i], score: s });
		}
		scored.sort(function (a, b) { return b.score - a.score; });
		return { hits: scored.slice(0, k || CONFIG.topK), lang: usedLang };
	};

	/* ----------------------------------------------------------------
	 * 3b. Fuzzy repair of out-of-vocabulary tokens
	 *
	 * This is the component the paper credits with recovering ~11% of queries
	 * that would otherwise fail. "hostal fes" -> "hostel fees".
	 * ---------------------------------------------------------------- */

	Index.prototype.repair = function (tokens) {
		var out = [];
		var repairs = [];
		for (var i = 0; i < tokens.length; i++) {
			var tok = tokens[i];
			if (this.vocab[tok]) { out.push(tok); continue; }

			var best = null, bestScore = 0;
			for (var v = 0; v < this.vocabList.length; v++) {
				var cand = this.vocabList[v];
				// cheap length gate before paying for the DP table
				if (Math.abs(cand.length - tok.length) > 3) continue;
				var s = similarity(tok, cand);
				if (s > bestScore) { bestScore = s; best = cand; }
			}
			if (best && bestScore >= CONFIG.fuzzyThreshold) {
				out.push(best);
				repairs.push({ from: tok, to: best, score: Number(bestScore.toFixed(3)) });
			} else {
				out.push(tok); // keep it; it may still be a meaningful proper noun
			}
		}
		return { tokens: out, repairs: repairs };
	};

	/* ----------------------------------------------------------------
	 * 4b. Whole-question fuzzy match
	 * ---------------------------------------------------------------- */

	Index.prototype.fuzzyQuestion = function (text, lang) {
		var q = normalise(text);
		if (!q || q.length > CONFIG.maxFuzzyLen) return null;
		var entries = this.kb.entries || [];
		var best = null, bestScore = 0;
		for (var e = 0; e < entries.length; e++) {
			var block = entries[e][lang] || entries[e].en;
			if (!block || !block.q) continue;
			for (var v = 0; v < block.q.length; v++) {
				var s = similarity(q, normalise(block.q[v]));
				if (s > bestScore) { bestScore = s; best = entries[e]; }
			}
		}
		if (best && bestScore >= CONFIG.fuzzyThreshold) {
			return { entry: best, score: bestScore };
		}
		return null;
	}

	/* ----------------------------------------------------------------
	 * 7. Memory buffer
	 * ---------------------------------------------------------------- */

	function Memory(limit) {
		this.limit = limit || CONFIG.memoryTurns;
		this.turns = [];
	}

	Memory.prototype.push = function (turn) {
		this.turns.push(turn);
		// A turn is one user message plus its reply. Oldest is dropped, and it is
		// gone - the paper notes the resulting amnesia in long sessions and so
		// do we, rather than silently persisting to storage.
		while (this.turns.length > this.limit) this.turns.shift();
	};

	Memory.prototype.last = function () {
		return this.turns.length ? this.turns[this.turns.length - 1] : null;
	};

	Memory.prototype.clear = function () { this.turns = []; };

	// Deliberately narrow. An earlier version included "there", "this" and "and",
	// which fired on ordinary questions like "is there a metro station nearby"
	// and dragged the previous topic into an unrelated query.
	var FOLLOWUP_CUES = {
		en: ["it", "that one", "they", "those", "what about", "how about", "and for"],
		kn: ["\u0C85\u0CA6\u0CC1", "\u0C85\u0CB2\u0CCD\u0CB2\u0CBF", "\u0CB9\u0CBE\u0C97\u0CC6"],
		hi: ["\u0935\u0939", "\u0909\u0938", "\u0935\u0939\u093E\u0901", "\u0914\u0930"],
		ur: ["\u0648\u06C1", "\u0627\u0633", "\u0648\u06C1\u0627\u06BA"]
	};

	// A short query full of pronouns is probably about the previous topic.
	function looksLikeFollowUp(text, lang) {
		var t = normalise(text);
		if (t.split(" ").length > 6) return false;
		var cues = (FOLLOWUP_CUES[lang] || []).concat(FOLLOWUP_CUES.en);
		for (var i = 0; i < cues.length; i++) {
			if (t.indexOf(cues[i]) !== -1) return true;
		}
		return false;
	}

	/* ----------------------------------------------------------------
	 * Engine
	 * ---------------------------------------------------------------- */

	function Engine(kb, options) {
		if (!kb || !kb.entries) throw new Error("Engine requires a knowledge base with entries");
		this.kb = kb;
		this.config = {};
		for (var key in CONFIG) {
			if (Object.prototype.hasOwnProperty.call(CONFIG, key)) this.config[key] = CONFIG[key];
		}
		if (options) {
			for (var o in options) {
				if (Object.prototype.hasOwnProperty.call(options, o)) this.config[o] = options[o];
			}
		}
		this.index = new Index(kb);
		this.memory = new Memory(this.config.memoryTurns);
		this.llmHook = null;
		this.counters = { asked: 0, answered: 0, outOfScope: 0, fuzzyRecovered: 0 };
	}

	// The documented swap point. Give it an async function and the engine will
	// hand it the retrieved chunks for phrasing. Absent a hook, answers are
	// returned verbatim from the knowledge base - which is why this works offline.
	Engine.prototype.setLlmHook = function (fn) { this.llmHook = typeof fn === "function" ? fn : null; };

	Engine.prototype.languages = function () {
		return (this.kb.meta && this.kb.meta.languages) || ["en"];
	};

	Engine.prototype.pickBlock = function (entry, lang) {
		if (entry[lang] && entry[lang].a) return { block: entry[lang], lang: lang, fellBack: false };
		return { block: entry.en, lang: "en", fellBack: lang !== "en" };
	};

	// Contested figures never get asserted as a single value.
	Engine.prototype.conflictNote = function (entry, lang) {
		var keys = entry.conflicts;
		if (!keys || !keys.length) return null;
		var registry = (this.kb.meta && this.kb.meta.conflicts) || {};
		var found = [];
		for (var i = 0; i < keys.length; i++) {
			if (registry[keys[i]]) found.push({ field: keys[i], values: registry[keys[i]] });
		}
		if (!found.length) return null;
		return { fields: found, text: this.phraseConflict(lang) };
	};

	Engine.prototype.phraseConflict = function (lang) {
		var f = (this.kb.fallbacks && this.kb.fallbacks.conflict) || {};
		if (f[lang]) return f[lang];
		if (f.en) return f.en;
		return "Published sources disagree on this figure, so please confirm it with the college office before you rely on it.";
	};

	Engine.prototype.outOfScope = function (lang, query) {
		var f = (this.kb.fallbacks && this.kb.fallbacks.outOfScope) || {};
		var raw = f[lang] || f.en ||
			"I do not have reliable information on that. Please contact the college directly rather than take a guess from me.";
		var resolved = resolveTokens(raw, this.kb.meta && this.kb.meta.tokens, lang);
		var text = resolved.text;
		var contacts = (this.kb.meta && this.kb.meta.contacts) || {};
		return {
			type: "out_of_scope",
			answer: text,
			lang: lang,
			confidence: 0,
			query: query,
			sources: [],
			handoff: contacts
		};
	};

	/**
	 * Run TF-IDF retrieval and reduce the top-K chunks to a single entry.
	 * Chunks vote: an entry matched by several chunks beats one lucky chunk,
	 * but the sum is damped so that merely long entries cannot dominate.
	 */
	Engine.prototype.retrieve = function (tokens, lang, trace, label) {
		var res = this.index.search(tokens, lang, this.config.topK);
		trace.steps.push({
			step: label || "retrieval",
			lang: res.lang,
			top: res.hits.map(function (h) {
				return { entry: h.doc.entryId, score: Number(h.score.toFixed(3)) };
			})
		});
		if (!res.hits.length) return { entry: null, confidence: 0, sources: [] };

		var agg = Object.create(null);
		for (var i = 0; i < res.hits.length; i++) {
			var h = res.hits[i];
			var cur = agg[h.doc.entryId] || { best: 0, rest: 0 };
			if (h.score > cur.best) { cur.rest += cur.best; cur.best = h.score; }
			else { cur.rest += h.score; }
			agg[h.doc.entryId] = cur;
		}
		var winner = null, winnerScore = -1;
		for (var id in agg) {
			if (!Object.prototype.hasOwnProperty.call(agg, id)) continue;
			var combined = agg[id].best + (0.15 * agg[id].rest);
			if (combined > winnerScore) { winnerScore = combined; winner = id; }
		}
		return {
			entry: this.index.entryById[winner],
			confidence: agg[winner].best,
			sources: res.hits.map(function (h) {
				return { entryId: h.doc.entryId, category: h.doc.category, score: Number(h.score.toFixed(3)) };
			})
		};
	};

	/**
	 * Answer a query. Synchronous when no LLM hook is set.
	 * Returns a result object; never throws for ordinary input.
	 */
	Engine.prototype.ask = function (rawQuery, forcedLang) {
		this.counters.asked++;
		var query = normalise(rawQuery);
		var trace = { steps: [] };

		if (!query) {
			return this.outOfScope(forcedLang || "en", rawQuery);
		}

		// 1. language
		var lang = forcedLang || detectLanguage(rawQuery, this.languages());
		trace.steps.push({ step: "language", value: lang });

		// 2 + 3. tokenise, then repair unknown tokens
		var tokens = tokenise(query, lang);
		var repaired = this.index.repair(tokens);
		if (repaired.repairs.length) {
			this.counters.fuzzyRecovered++;
			trace.steps.push({ step: "fuzzy_repair", repairs: repaired.repairs });
		}
		tokens = repaired.tokens;

		// 4. whole-question fuzzy match short-circuits retrieval
		var direct = this.index.fuzzyQuestion(query, lang);
		var entry = null, confidence = 0, sources = [];

		if (direct) {
			entry = direct.entry;
			confidence = direct.score;
			trace.steps.push({ step: "fuzzy_question_match", entry: entry.id, score: Number(confidence.toFixed(3)) });
		} else {
			// 5. TF-IDF cosine retrieval, top-5, on the query as it was asked
			var primary = this.retrieve(tokens, lang, trace, "retrieval");
			entry = primary.entry;
			confidence = primary.confidence;
			sources = primary.sources;

			// Only if that was weak do we consider the previous topic. Conversation
			// context is a rescue for genuinely elliptical questions ("what about
			// the fee for it"), never an override on a question that stood alone.
			var prev = this.memory.last();
			if (prev && prev.entryId && confidence < this.config.strongMatch && looksLikeFollowUp(query, lang)) {
				var prevEntry = this.index.entryById[prev.entryId];
				if (prevEntry) {
					var augmented = tokens.concat(tokenise((prevEntry.tags || []).join(" "), lang));
					var withContext = this.retrieve(augmented, lang, trace, "retrieval_with_context");
					if (withContext.entry && withContext.confidence > confidence) {
						entry = withContext.entry;
						confidence = withContext.confidence;
						sources = withContext.sources;
						trace.steps.push({ step: "followup_context", from: prev.entryId, adopted: true });
					}
				}
			}
		}

		// 6. confidence floor - the paper's acknowledged gap
		if (!entry || confidence < this.config.confidenceFloor) {
			this.counters.outOfScope++;
			trace.steps.push({ step: "confidence_floor", confidence: Number(confidence.toFixed(3)), floor: this.config.confidenceFloor, outcome: "refused" });
			var refusal = this.outOfScope(lang, rawQuery);
			refusal.trace = trace;
			this.memory.push({ query: rawQuery, lang: lang, entryId: null, outOfScope: true });
			return refusal;
		}

		var picked = this.pickBlock(entry, lang);
		var resolvedAnswer = resolveTokens(picked.block.a, this.kb.meta && this.kb.meta.tokens, picked.lang);
		var answer = resolvedAnswer.text;
		if (resolvedAnswer.unresolved.length) {
			trace.steps.push({ step: "unresolved_tokens", tokens: resolvedAnswer.unresolved });
		}
		var conflict = this.conflictNote(entry, picked.lang);

		this.counters.answered++;
		this.memory.push({ query: rawQuery, lang: lang, entryId: entry.id, outOfScope: false });

		return {
			type: "answer",
			entryId: entry.id,
			category: entry.category,
			// which landing-page section answers this, so the UI can navigate there
			section: entry.section || null,
			answer: answer,
			unresolvedTokens: resolvedAnswer.unresolved,
			lang: picked.lang,
			languageFellBack: picked.fellBack,
			confidence: Number(confidence.toFixed(3)),
			hedged: confidence < this.config.strongMatch,
			conflict: conflict,
			sources: sources,
			trace: trace
		};
	};

	// Session end. The paper clears the buffer here and keeps nothing.
	Engine.prototype.endSession = function () {
		this.memory.clear();
		return true;
	};

	Engine.prototype.sections = function () {
		return (this.kb.meta && this.kb.meta.sections) || {};
	};

	Engine.prototype.stats = function () {
		return {
			entries: (this.kb.entries || []).length,
			chunks: this.index.docs.length,
			vocabulary: this.index.vocabList.length,
			languages: this.languages(),
			counters: this.counters,
			memoryDepth: this.memory.turns.length + "/" + this.memory.limit
		};
	};

	Engine.prototype.quickReplies = function (lang) {
		var q = this.kb.quickReplies || {};
		return q[lang] || q.en || [];
	};

	/* Exports - plus the internals, so the test page can exercise them. */
	var api = {
		Engine: Engine,
		CONFIG: CONFIG,
		internals: {
			levenshtein: levenshtein,
			similarity: similarity,
			normalise: normalise,
			tokenise: tokenise,
			detectLanguage: detectLanguage,
			chunk: chunk,
			cosine: cosine,
			resolveTokens: resolveTokens
		}
	};

	// Browser: window.HKBKChat. Node (test harness only): module.exports.
	global.HKBKChat = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : this));
