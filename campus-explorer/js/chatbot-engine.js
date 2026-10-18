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
		confidenceFloor: 0.17,  // NOT in the paper - see docs. Kept as the legacy
		                        // name; acts as clarifyFloor when set directly.
		strongMatch: 0.55,      // above this we answer without hedging
		maxFuzzyLen: 60,        // don't Levenshtein whole paragraphs
		answerFloor: 0.22,      // calibrated refusal, NOT in the paper. At or above
		                        // this: answer. Tuned on the dev split of
		                        // eval/questions.json - see eval/README.md.
		clarifyFloor: 0.15,     // between this and answerFloor: ask "did you mean"
		                        // instead of guessing or dead-ending. Below: refuse.
		ambiguityMargin: 0.02,  // runner-up this close (and not a strong match):
		                        // offer both entries instead of picking one
		coveragePenalty: true,  // scale confidence by the share of the query's
		                        // content tokens the KB vocabulary actually covers.
		                        // "hack the exam portal" scores on "exam" alone;
		                        // coverage 1/3 pulls it under the refusal floor.
		retriever: "tfidf",     // scoring function for retrieval: "tfidf"
		                        // (cosine, as shipped) or "bm25" (Okapi BM25,
		                        // normalised against the query's own score so the
		                        // calibrated floors still apply). Baseline switch
		                        // for the /eval comparison - the UI ships tfidf.
		repair: true,           // fuzzy repair of out-of-vocabulary tokens.
		                        // false ablates step 3 for the /eval comparison.
		bm25K1: 1.5,            // Okapi BM25 term-frequency saturation
		bm25B: 0.75             // Okapi BM25 length normalisation
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
			" get got tell give please kindly want need know am much many done just really also any some happen happens run runs").split(" "),
		kn: "\u0c8f\u0cb7\u0ccd\u0c9f\u0cc1 \u0c8f\u0ca8\u0cc1 \u0cb9\u0cc7\u0c97\u0cc6 \u0c8e\u0cb2\u0ccd\u0cb2\u0cbf \u0caf\u0cbe\u0cb5 \u0cae\u0ca4\u0ccd\u0ca4\u0cc1 \u0c85\u0ca5\u0cb5\u0cbe \u0c87\u0ca6\u0cc6\u0caf\u0cbe \u0c87\u0ca6\u0cc6\u0caf\u0cc7 \u0c89\u0c82\u0c9f\u0cbe \u0c86\u0c97\u0cbf\u0cb0\u0cc1\u0ca4\u0ccd\u0ca4\u0cc6 \u0c88\u0ca4\u0cc1 \u0c85\u0ca6\u0cc1 \u0c87\u0ca6\u0cc1 \u0ca8\u0cae\u0c97\u0cc6 \u0ca8\u0cbe\u0ca8\u0cc1 \u0ca6\u0caf\u0cb5\u0cbf\u0c9f\u0ccd\u0c9f\u0cc1".split(" ")
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

	/* \p{M} matters: Indic vowel signs and the virama are combining marks,
	 * not letters. Without them "ವೈಫೈ" shredded into single consonants and
	 * every Kannada token missed the vocabulary. */
	var WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;

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
		this.langDf = Object.create(null);   // per-language df: idf comes from
		                                     // the language's own corpus
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
						var ldf = this.langDf[lang] || (this.langDf[lang] = Object.create(null));
						ldf[term] = (ldf[term] || 0) + 1;
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
		this.docCount = N;
		var totalLen = 0;
		for (var dl = 0; dl < this.docs.length; dl++) totalLen += this.docs[dl].length;
		this.avgdl = totalLen / N || 1;
		this.idf = Object.create(null);
		for (var t in this.df) {
			if (!Object.prototype.hasOwnProperty.call(this.df, t)) continue;
			this.idf[t] = Math.log(1 + (N / this.df[t]));
		}
		/* per-language idf and stats: a query in one language must not have
		 * its weights shifted by another language's documents. The global
		 * tables above stay for vocabulary-coverage checks only. */
		this.langIdf = Object.create(null);
		this.langN = Object.create(null);
		this.langAvgdl = Object.create(null);
		for (var lg in this.byLang) {
			if (!Object.prototype.hasOwnProperty.call(this.byLang, lg)) continue;
			var ldocs = this.byLang[lg];
			var lN = ldocs.length || 1;
			this.langN[lg] = lN;
			var llen = 0;
			for (var ld = 0; ld < ldocs.length; ld++) llen += ldocs[ld].length;
			this.langAvgdl[lg] = llen / lN || 1;
			var lidf = Object.create(null);
			var ldf2 = this.langDf[lg] || {};
			for (var lt in ldf2) {
				if (!Object.prototype.hasOwnProperty.call(ldf2, lt)) continue;
				lidf[lt] = Math.log(1 + (lN / ldf2[lt]));
			}
			this.langIdf[lg] = lidf;
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
			var didf = this.langIdf[doc.lang] || this.idf;
			var weight = (1 + Math.log(doc.tf[term])) * (didf[term] || 0);
			vec[term] = weight;
			sum += weight * weight;
		}
		doc.vec = vec;
		doc.norm = Math.sqrt(sum) || 1;
	};

	Index.prototype.queryVector = function (tokens, lang) {
		var tf = Object.create(null);
		for (var i = 0; i < tokens.length; i++) {
			tf[tokens[i]] = (tf[tokens[i]] || 0) + 1;
		}
		var vec = Object.create(null);
		var sum = 0;
		for (var term in tf) {
			if (!Object.prototype.hasOwnProperty.call(tf, term)) continue;
			var qidfMap = this.langIdf[lang] || this.idf;
			var weight = (1 + Math.log(tf[term])) * (qidfMap[term] || 0);
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

		var qv = this.queryVector(tokens, usedLang);
		var scored = [];
		for (var i = 0; i < pool.length; i++) {
			var s = cosine(qv, pool[i]);
			if (s > 0) scored.push({ doc: pool[i], score: s });
		}
		scored.sort(function (a, b) { return b.score - a.score; });
		return { hits: scored.slice(0, k || CONFIG.topK), lang: usedLang };
	};

	// Okapi BM25 over the same chunks. Raw BM25 scores are unbounded, so the
	// score is divided by the query's own best-case score (each query term
	// contributing its idf once) - a document containing every query term at
	// average length scores ~1. That keeps the calibrated refusal floors
	// meaningful across both scorers. Baseline for the /eval comparison.
	Index.prototype.searchBM25 = function (tokens, lang, k, k1, b) {
		var pool = this.byLang[lang];
		var usedLang = lang;
		if (!pool || !pool.length) { pool = this.byLang.en || []; usedLang = "en"; }

		k1 = (typeof k1 === "number") ? k1 : CONFIG.bm25K1;
		b = (typeof b === "number") ? b : CONFIG.bm25B;
		var N = this.langN[usedLang] || this.docCount, avg = this.langAvgdl[usedLang] || this.avgdl;
		var poolDf = this.langDf[usedLang] || this.df;
		var qtf = Object.create(null);
		for (var i = 0; i < tokens.length; i++) qtf[tokens[i]] = (qtf[tokens[i]] || 0) + 1;
		var norm = 0;
		var qidf = Object.create(null);
		for (var t in qtf) {
			if (!Object.prototype.hasOwnProperty.call(qtf, t)) continue;
			var df = poolDf[t] || 0;
			qidf[t] = Math.log(1 + (N - df + 0.5) / (df + 0.5));
			if (df) norm += qidf[t];
		}
		if (!norm) return { hits: [], lang: usedLang };

		var scored = [];
		for (var d = 0; d < pool.length; d++) {
			var doc = pool[d];
			var K = k1 * (1 - b + b * (doc.length / avg));
			var s = 0;
			for (var term in qidf) {
				if (!Object.prototype.hasOwnProperty.call(qidf, term)) continue;
				var f = doc.tf[term];
				if (!f) continue;
				s += qidf[term] * (f * (k1 + 1)) / (f + K);
			}
			/* normalised against the query's true best case: each term can
			 * contribute at most idf*(k1+1), so s/(norm*(k1+1)) is in (0,1]
			 * with no clamp - the old Math.min(1, s/norm) saturated at 1.0
			 * and destroyed the ranking ties. */
			if (s > 0) scored.push({ doc: doc, score: s / (norm * (k1 + 1)) });
		}
		scored.sort(function (a, b2) { return b2.score - a.score; });
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
			// 0.78 is unreachable for short tokens, so a token of up to 5
			// letters is also repaired on a single INSERT or DELETE (length
			// differs by one). Substitutions are refused: one letter swapped
			// in a 3-letter word is anyone's guess ("won" is not "non"),
			// while a dropped letter is the classic typo ("fes" -> "fees").
			var shortOk = tok.length <= 5 && best &&
				levenshtein(tok, best) === 1 &&
				Math.abs(best.length - tok.length) === 1 && bestScore >= 0.6;
			if (best && (bestScore >= CONFIG.fuzzyThreshold || shortOk)) {
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
		// Backwards compatibility: a caller that sets the old single
		// confidenceFloor is really setting the clarify floor.
		if (options && Object.prototype.hasOwnProperty.call(options, "confidenceFloor") &&
				!Object.prototype.hasOwnProperty.call(options, "clarifyFloor")) {
			this.config.clarifyFloor = options.confidenceFloor;
		}
		this.index = new Index(kb);
		this.memory = new Memory(this.config.memoryTurns);
		this.llmHook = null;
		this.counters = { asked: 0, answered: 0, clarified: 0, outOfScope: 0, fuzzyRecovered: 0 };
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
		/* fallbacks are nested per language (fallbacks.kn.conflict); an older
		 * flat shape (fallbacks.conflict.en) is still tolerated */
		var perLang = this.kb.fallbacks && this.kb.fallbacks[lang];
		if (perLang && perLang.conflict) return perLang.conflict;
		var f = (this.kb.fallbacks && this.kb.fallbacks.conflict) || {};
		if (f[lang]) return f[lang];
		if (f.en) return f.en;
		var en = this.kb.fallbacks && this.kb.fallbacks.en;
		if (en && en.conflict) return en.conflict;
		return "Published sources disagree on this figure, so please confirm it with the college office before you rely on it.";
	};

	Engine.prototype.outOfScope = function (lang, query) {
		/* nested per-language shape first (fallbacks.kn.outOfScope) - the flat
		 * lookup used to miss it and refuse in English on Kannada queries */
		var perLang = this.kb.fallbacks && this.kb.fallbacks[lang];
		var f = (this.kb.fallbacks && this.kb.fallbacks.outOfScope) || {};
		var raw = (perLang && perLang.outOfScope) || f[lang] ||
			(this.kb.fallbacks && this.kb.fallbacks.en && this.kb.fallbacks.en.outOfScope) || f.en ||
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

	// The middle band: confident enough to have a suspect, not confident enough
	// to state it as fact. Offers the canonical phrasing of the best entry (and
	// of the runner-up when the margin check fired) so the user can pick with
	// one tap. fallbacks.<lang>.clarify carries the wording.
	Engine.prototype.clarify = function (lang, query, suggestions, sources) {
		var fb = (this.kb.fallbacks && (this.kb.fallbacks[lang] || this.kb.fallbacks.en)) || {};
		var raw = fb.clarify || "I am not certain I understood that. Did you mean one of these?";
		var resolved = resolveTokens(raw, this.kb.meta && this.kb.meta.tokens, lang);
		return {
			type: "clarify",
			answer: resolved.text,
			lang: lang,
			confidence: Number(suggestions[0].confidence.toFixed(3)),
			query: query,
			suggestions: suggestions.map(function (s) {
				var block = (s.entry[lang] && s.entry[lang].a ? s.entry[lang] : s.entry.en) || { q: [] };
				return {
					entryId: s.entry.id,
					category: s.entry.category,
					question: (block.q && block.q[0]) || s.entry.id,
					confidence: Number(s.confidence.toFixed(3)),
					walkStop: s.entry.walkStop || null
				};
			}),
			sources: sources || []
		};
	};

	/**
	 * Run TF-IDF retrieval and reduce the top-K chunks to a single entry.
	 * Chunks vote: an entry matched by several chunks beats one lucky chunk,
	 * but the sum is damped so that merely long entries cannot dominate.
	 */
	Engine.prototype.retrieve = function (tokens, lang, trace, label) {
		var res = this.config.retriever === "bm25"
			? this.index.searchBM25(tokens, lang, this.config.topK, this.config.bm25K1, this.config.bm25B)
			: this.index.search(tokens, lang, this.config.topK);
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
		var ranked = [];
		for (var id in agg) {
			if (!Object.prototype.hasOwnProperty.call(agg, id)) continue;
			ranked.push({ id: id, best: agg[id].best, combined: agg[id].best + (0.15 * agg[id].rest) });
		}
		ranked.sort(function (a, b) { return b.combined - a.combined; });
		var winner = ranked[0];
		var runner = ranked.length > 1 ? ranked[1] : null;
		return {
			entry: this.index.entryById[winner.id],
			confidence: winner.best,
			// full entry ranking (best chunk score per entry) for eval rank metrics
			ranking: ranked.map(function (r) { return r.id; }),
			runnerUp: runner ? { entry: this.index.entryById[runner.id], confidence: runner.best } : null,
			sources: res.hits.map(function (h) {
				return { entryId: h.doc.entryId, category: h.doc.category, score: Number(h.score.toFixed(3)) };
			})
		};
	};


	/* Straight-line metres between two coordinates. Used for direction
	 * estimates; the answer labels the figure as an estimate. */
	function haversineM(a, b) {
		var R = 6371000, rad = Math.PI / 180;
		var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
		var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
			Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return 2 * R * Math.asin(Math.sqrt(h));
	}

	/* Campus directions (2026-10). Routes are offered ONLY along the filmed
	 * campus walk, between stops the footage connects, in walk order. A place
	 * with no footage gets an honest "cannot verify" answer, never an invented
	 * route. Data lives in kb.directions and mirrors walk/walk-data.js. */
	Engine.prototype.directionGazetteer = function () {
		if (this._gazetteer) return this._gazetteer;
		var dirs = (this.kb && this.kb.directions) || null;
		var g = { stops: [], noFootage: [], updated: dirs ? dirs.updated : null };
		if (dirs) {
			g.stops = dirs.stops || [];
			g.noFootage = dirs.noFootage || [];
		}
		this._gazetteer = g;
		return g;
	};

	/* Longest-alias match of a free-text place fragment against the gazetteer.
	 * Returns { name, stopId|null, footage, lat, lon } or null. */
	Engine.prototype.resolvePlace = function (fragment) {
		if (!fragment) return null;
		/* strip fillers and stray direction verbs, then require the matched
		 * alias to cover most of what is left - "hostel office for fee
		 * payment" must not resolve to the hostel just because "hostel"
		 * appears in it */
		var cleaned = normalise(fragment)
			.replace(/^(?:the\s+)?(?:get|go|walk|reach|travel|head)\s+(?:to\s+)?/, "")
			.replace(/^the\s+/, "").replace(/\s+(please|now)$/, "").trim();
		if (!cleaned) return null;
		var text = " " + cleaned + " ";
		var g = this.directionGazetteer();
		var best = null, bestLen = 0;
		function consider(place, stopId, footage) {
			var aliases = [place.name].concat(place.aliases || []);
			for (var i = 0; i < aliases.length; i++) {
				var a = normalise(aliases[i]);
				if (!a) continue;
				if ((text === " " + a + " " || text.indexOf(" " + a + " ") !== -1) &&
						a.length >= 0.6 * cleaned.length && a.length > bestLen) {
					best = { name: place.name, stopId: stopId, footage: footage, lat: place.lat, lon: place.lon };
					bestLen = a.length;
				}
			}
		}
		g.stops.forEach(function (st) { consider(st, st.id, true); });
		g.noFootage.forEach(function (pl) { consider(pl, null, false); });
		return best;
	};

	/* Detect a directions request and split out origin/destination fragments.
	 * Returns { origin: string|null, dest: string } or null when the query is
	 * not a directions request. Only fires on an explicit direction cue, so
	 * plain location questions ("where is the library") stay with retrieval. */
	Engine.prototype.parseDirections = function (query) {
		var cue = /\b(directions?|route|path|way|reach|walk|get|go|travel|take me)\b/.test(query);
		// A bare "from A to B" needs no cue word: it only fires when BOTH
		// endpoints resolve to known gazetteer places, which ordinary
		// questions do not.
		var m = query.match(/\bfrom\s+(.+?)\s+(?:to|towards?)\s+(.+?)[?.!]*$/);
		// Without a cue word, fire only when the destination resolves - an
		// unknown origin is answered honestly downstream, never silently
		// replaced with the gate.
		if (m && (cue || this.resolvePlace(m[2]))) {
			return { origin: m[1], dest: m[2] };
		}
		if (!cue) return null;
		m = query.match(/\bto\s+(.+?)\s+from\s+(.+?)[?.!]*$/);
		if (m) return { origin: m[2], dest: m[1] };
		m = query.match(/\b(?:directions?|route|path|way)\s+(?:to|towards?|for)\s+(.+?)[?.!]*$/)
			|| query.match(/\b(?:get|go|walk)\s+to\s+(.+?)[?.!]*$/)
			|| query.match(/\btake me to\s+(.+?)[?.!]*$/)
			|| query.match(/\breach\s+(.+?)[?.!]*$/);
		if (m) {
			var frag = m[1];
			var f2 = frag.match(/^(.+?)\s+from\s+(.+?)[?.!]*$/);
			if (f2) return { origin: f2[2], dest: f2[1] };
			return { origin: null, dest: frag };
		}
		return null;
	};

	Engine.prototype.directionsAnswer = function (lang, parsed, trace) {
		var g = this.directionGazetteer();
		var self = this;
		var dest = this.resolvePlace(parsed.dest);
		if (!dest) return null; // not a place we know: let retrieval handle it
		var origin = parsed.origin ? this.resolvePlace(parsed.origin) : null;
		var originDefaulted = false;
		var contact = (this.kb.meta && this.kb.meta.tokens && this.kb.meta.tokens.admissionsIndian) || "+91 90350 22250";
		if (parsed.origin && !origin) {
			/* the user named a start point we do not know: say so instead of
			 * silently routing from the gate or dropping to retrieval */
			trace.steps.push({ step: "directions", outcome: "origin_unknown", fragment: parsed.origin });
			return base({
				answer: "I do not know " + parsed.origin.replace(/^the\s+/i, "") +
					" on this campus, so I cannot verify a route from there. Routes I can verify start at the " +
					g.stops[0].name + " or another filmed stop - ask, for example, \u201Chow do I get to the " +
					dest.name + " from the " + g.stops[0].name + "\u201D.",
				directions: "origin_unknown"
			});
		}

		function base(extra) {
			var res = {
				type: "answer",
				entryId: "directions",
				category: "directions",
				section: "walk",
				walkStop: null,
				walkStopName: null,
				/* deterministic route lookup, not a retrieval score: no
				 * confidence, so usage-log bands stay retrieval-only */
				confidence: null,
				hedged: false,
				conflict: null,
				sources: [],
				unresolvedTokens: [],
				lang: lang,
				languageFellBack: false,
				source: {
					entryId: "directions",
					category: "directions",
					updated: g.updated,
					kbVersion: (self.kb.meta && self.kb.meta.version) || null
				},
				trace: trace
			};
			for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) res[k] = extra[k];
			return res;
		}
		var noRoute = "I can only give directions along the route our campus footage covers, and DEST is not on it, so I cannot verify a walking route there. The office can point you: PHONE.";

		if (!dest.footage) {
			trace.steps.push({ step: "directions", outcome: "no_footage", place: dest.name });
			return base({ answer: noRoute.replace("DEST", "the " + dest.name).replace("PHONE", contact), directions: "unavailable" });
		}
		if (origin && !origin.footage) {
			trace.steps.push({ step: "directions", outcome: "origin_no_footage", place: origin.name });
			return base({ answer: noRoute.replace("DEST", "the " + origin.name).replace("PHONE", contact), directions: "unavailable" });
		}

		var order = g.stops;
		if (!origin) { origin = order[0] && { name: order[0].name, stopId: order[0].id, footage: true }; originDefaulted = true; }
		var fromIdx = -1, toIdx = -1;
		for (var i = 0; i < order.length; i++) {
			if (order[i].id === origin.stopId) fromIdx = i;
			if (order[i].id === dest.stopId) toIdx = i;
		}
		if (fromIdx === -1 || toIdx === -1) return null;
		if (fromIdx === toIdx) {
			trace.steps.push({ step: "directions", outcome: "same_place", place: dest.name, originDefaulted: originDefaulted });
			return base({
				answer: originDefaulted
					/* the user never said where they are - claiming "you are
					 * already there" would be invented */
					? "The " + dest.name + " is the start of the filmed campus walk, so there is no route to compute - the walk begins there."
					: "Those are the same place - " + dest.name + ", so there is no route to compute.",
				walkStop: dest.stopId, walkStopName: dest.name, directions: "same"
			});
		}

		var reversed = fromIdx > toIdx;
		var step = reversed ? -1 : 1;
		var names = [], metres = 0, distOk = true;
		for (var j = fromIdx; j !== toIdx + step; j += step) {
			names.push(order[j].name);
			if (j !== toIdx) {
				var a = order[j], b = order[j + step];
				if (typeof a.lat !== "number" || typeof b.lat !== "number") { distOk = false; }
				else metres += haversineM(a, b);
			}
		}
		if (!isFinite(metres)) distOk = false;
		var approx = Math.round(metres / 10) * 10;
		trace.steps.push({
			step: "directions", outcome: "route",
			from: origin.stopId, to: dest.stopId,
			via: names.length - 2, metres: distOk ? approx : null, reversed: reversed
		});
		var answer = "From " + origin.name + " to " + dest.name + ", follow the campus walk route: " +
			names.join(" \u2192 ") + ".";
		if (distOk) {
			answer += " That is at least roughly " + approx +
				" m (straight-line between the filmed stops, so the real path is a little longer).";
		}
		if (reversed) {
			answer += " The walk was filmed in the other direction, so you would follow it in reverse.";
		}
		answer += " This is the only route I can verify - it is the one our footage covers.";
		return base({
			answer: answer,
			walkStop: dest.stopId, walkStopName: dest.name,
			directions: "route"
		});
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

		// 1b. campus directions short-circuit (English data only): an explicit
		// "how do I get to X" / "directions to X" / "from A to B" request is
		// answered from the filmed-walk route graph, or refused honestly when
		// the place has no footage. Never guesses a route.
		if (lang === "en") {
			var dirq = this.parseDirections(query);
			if (dirq) {
				var dres = this.directionsAnswer(lang, dirq, trace);
				if (dres) {
					this.counters.answered++;
					/* remember the destination's KB entry so a follow-up like
					 * "what about the timings" resolves against the place the
					 * route led to */
					var destEntry = null;
					if (dres.walkStop) {
						for (var ei = 0; ei < this.kb.entries.length; ei++) {
							if (this.kb.entries[ei].walkStop === dres.walkStop) { destEntry = this.kb.entries[ei].id; break; }
						}
					}
					this.memory.push({ query: rawQuery, lang: lang, entryId: destEntry, directions: true });
					return dres;
				}
			}
		}

		// 2 + 3. tokenise, then repair unknown tokens
		var tokens = tokenise(query, lang);
		var repaired = this.config.repair === false
			? { tokens: tokens, repairs: [] }
			: this.index.repair(tokens);
		if (repaired.repairs.length) {
			this.counters.fuzzyRecovered++;
			trace.steps.push({ step: "fuzzy_repair", repairs: repaired.repairs });
		}
		tokens = repaired.tokens;

		// Content-token coverage: the share of query tokens the KB vocabulary
		// covers after fuzzy repair. A confident score built on one shared word
		// ("code" in "dress code" -> "cet code") is a coincidence, not a match,
		// so confidence is scaled by it. Tuned on the dev split like the floors.
		// Coverage: the share of the query's content tokens the KB vocabulary
		// covers after fuzzy repair. It scales retrieval confidence SQUARED:
		// one shared word in a four-word query ("exam" in "hack the exam
		// portal") is weak evidence twice over - the match is thin and most of
		// the question is unknown. Tuned on the dev split like the floors.
		var coverage = 1;
		var repairedSet = Object.create(null);
		repaired.repairs.forEach(function (r) { repairedSet[r.to] = true; });
		if (this.config.coveragePenalty) {
			var covered = 0;
			for (var ci = 0; ci < tokens.length; ci++) {
				if (this.index.vocab[tokens[ci]]) covered++;
			}
			coverage = tokens.length ? covered / tokens.length : 0;
			if (coverage < 1) {
				trace.steps.push({ step: "coverage", covered: covered, total: tokens.length, value: Number(coverage.toFixed(3)) });
			}
		}

		// 4. whole-question fuzzy match short-circuits retrieval
		var direct = this.index.fuzzyQuestion(query, lang);
		var entry = null, confidence = 0, sources = [], runnerUp = null, ranking = [];

		// The whole-question shortcut is for typos of STORED questions. A
		// near-identical string (>= 0.90) is a typo and always fires; a merely
		// similar one (0.78-0.90) fires only when every content word is known
		// to the KB exactly as typed. "Dress code" shares "code" with the
		// stored "what is the cet code" - 0.82 similar, unknown word "dress",
		// and still not that question. Direct confidence is the string
		// similarity itself, so it is not coverage-scaled.
		if (direct && direct.score < 0.9 && coverage < 1) {
			trace.steps.push({ step: "fuzzy_question_match", entry: direct.entry.id, score: Number(direct.score.toFixed(3)), skipped: "oov_tokens" });
			direct = null;
		}
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
			ranking = primary.ranking || [];
			runnerUp = primary.runnerUp;

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
						runnerUp = withContext.runnerUp;
						trace.steps.push({ step: "followup_context", from: prev.entryId, adopted: true });
					}
				}
			}
		}

		// Coverage scales retrieval confidence only. A direct whole-question
		// match is string-level evidence and already passed its own gate.
		if (!direct) confidence = confidence * coverage;

		// Half or more of the question's content words unknown: the system
		// cannot know what the question is about, so it refuses rather than
		// guess from the one word it recognised. "Who won the football world
		// cup" shares only "football" with anything on campus.
		var starved = !direct && this.config.coveragePenalty && coverage <= 0.5;

		// A repaired token is a guess. When the winning entry is supported ONLY
		// by guessed tokens - no word the user actually typed appears in it -
		// the answer is demoted out of the answer band: it may be offered as a
		// "did you mean", never stated as fact. "Write my python assignment"
		// repairs to "white" and would otherwise state B Block with a straight
		// face.
		if (!direct && entry) {
			var winnerDocs = this.index.docs.filter(function (d) { return d.entryId === entry.id; });
			var exactHit = false;
			for (var ti = 0; ti < tokens.length && !exactHit; ti++) {
				if (repairedSet[tokens[ti]] || !this.index.vocab[tokens[ti]]) continue;
				for (var di = 0; di < winnerDocs.length; di++) {
					if (winnerDocs[di].tf[tokens[ti]]) { exactHit = true; break; }
				}
			}
			if (!exactHit && tokens.length) {
				confidence = Math.min(confidence, this.config.answerFloor - 0.005);
				trace.steps.push({ step: "repaired_only_support", entry: entry.id, capped: Number(confidence.toFixed(3)) });
			}
		}

		// 6. calibrated refusal - the paper's acknowledged gap, as three bands.
		//    Below clarifyFloor: refuse with a human handoff. Between the floors:
		//    ask "did you mean" instead of guessing. At or above answerFloor:
		//    answer. A runner-up inside ambiguityMargin (and not a strong match)
		//    turns any band into a two-option clarify.
		if (!entry || starved || confidence < this.config.clarifyFloor) {
			this.counters.outOfScope++;
			trace.steps.push({ step: "confidence_floor", confidence: Number(confidence.toFixed(3)), floor: this.config.clarifyFloor, outcome: "refused" });
			var refusal = this.outOfScope(lang, rawQuery);
			refusal.trace = trace;
			refusal.ranking = ranking;
			this.memory.push({ query: rawQuery, lang: lang, entryId: null, outOfScope: true });
			return refusal;
		}

		var offered = [{ entry: entry, confidence: confidence }];
		var ambiguous = runnerUp && runnerUp.entry &&
			(confidence - runnerUp.confidence) < this.config.ambiguityMargin &&
			confidence < this.config.strongMatch;
		if (ambiguous) offered.push({ entry: runnerUp.entry, confidence: runnerUp.confidence });

		if (confidence < this.config.answerFloor || ambiguous) {
			this.counters.clarified++;
			trace.steps.push({
				step: "clarify_band",
				confidence: Number(confidence.toFixed(3)),
				answerFloor: this.config.answerFloor,
				clarifyFloor: this.config.clarifyFloor,
				ambiguous: !!ambiguous,
				offered: offered.map(function (o) { return o.entry.id; })
			});
			var clarifyRes = this.clarify(lang, rawQuery, offered, sources);
			clarifyRes.trace = trace;
			clarifyRes.ranking = ranking;
			// The top suggestion becomes the tentative topic, so a follow-up
			// ("what about the fee for it") still resolves against it.
			this.memory.push({ query: rawQuery, lang: lang, entryId: entry.id, clarified: true });
			return clarifyRes;
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
			// which campus-walk stop shows this place, if the entry has one
			walkStop: entry.walkStop || null,
			walkStopName: entry.walkStopName || null,
			answer: answer,
			unresolvedTokens: resolvedAnswer.unresolved,
			lang: picked.lang,
			languageFellBack: picked.fellBack,
			confidence: Number(confidence.toFixed(3)),
			hedged: confidence < this.config.strongMatch,
			conflict: conflict,
			sources: sources,
			ranking: ranking,
			// provenance for the UI's source line: which KB record answered,
			// when that record was last changed, and the KB version
			source: {
				entryId: entry.id,
				category: entry.category,
				updated: entry.updated || null,
				kbVersion: (this.kb.meta && this.kb.meta.version) || null
			},
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
