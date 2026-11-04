# Talk to HKBK - proxy worker

Optional online mode for the site's voice assistant. When this worker's URL
is set in `campus-explorer/js/talk-config.js`, the assistant phrases its
answers with an LLM. When it is not set, the site stays fully offline:
answers come verbatim from the on-device knowledge base, nothing leaves the
visitor's phone, and the paper's claims stay true.

The worker never invents facts. The site sends the knowledge-base answer it
already found; the model only rephrases it into natural conversation. A
question the knowledge base cannot answer is refused by the site before any
call is made.

## What it is

A single Cloudflare Worker (`worker.js`) that:

- accepts `POST /talk` with `{facts, question, history}` from the allowed
  site origins only (CORS allowlist in `ALLOWED_ORIGINS`),
- calls Groq's `qwen/qwen3.8-27b` chat completions (owner-chosen 2026-11-04; adjustable via the MODEL worker var) with a grounding
  system prompt (rephrase the given facts, add nothing, stay under ~60 words),
- caps input at 1200 characters and output at 220 tokens,
- applies a 6-second upstream timeout and returns the site's offline answer
  unchanged on any failure,
- burst-limits per IP (default 6/minute, owner-adjustable via the
  PER_IP_PER_MINUTE worker var) as abuse protection only. There is no daily
  visitor or global allowance: the real quota is Groq's own org limit
  (free tier: 1,000 requests/day, shared with the key's other projects).
  When that is spent, Groq returns 429 and the site openly shows its
  local-answers fallback - no hidden rationing, no fake AI replies,
- logs nothing about the conversation.

## Deploy (about 10 minutes, free)

1. Create a free Cloudflare account (Google sign-in works) at
   https://dash.cloudflare.com/sign-up - no card required. The Workers free
   plan includes 100,000 requests/day, far above this site's needs.
2. Install Wrangler and log in:
   `npm install -g wrangler && wrangler login`
3. From this directory: `wrangler deploy worker.js --name hkbk-talk --compatibility-date 2026-11-01`
4. Store the Groq key as a secret (never in the file, never in git):
   `wrangler secret put GROQ_API_KEY`
5. Put the worker URL the deploy prints
   (`https://hkbk-talk.<account>.workers.dev/talk`) into
   `campus-explorer/js/talk-config.js` as `TALK_PROXY_ENDPOINT` and add that
   origin to `ALLOWED_ORIGINS` if the site is served somewhere new.

## Cost envelope

- Cloudflare Workers free plan: 100,000 requests/day, 10 ms CPU per request.
- Groq free tier for `qwen/qwen3.8-27b` at the time of writing:
  30 requests/minute, 1,000 requests/day, 8,000 tokens/minute
  (verify the current numbers at https://console.groq.com/docs/rate-limits -
  limits are per organisation and change).
- The site's own guards are tighter than both: one call per question, no
  retries, per-IP and global daily caps in the worker, and the offline
  fallback takes over automatically when any limit is hit.

## Test

`node worker-test.mjs` - 21 checks over a mocked fetch: grounding prompt
content, caps, timeouts, CORS, rate limiting, failure fallbacks.
