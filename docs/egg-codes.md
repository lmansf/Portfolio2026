# Egg codes (the SQL console's nest-box hunt)

A visitor who finds the hidden `nest_box` table in the site's SQL console and
solves it gets a one-time **egg code**. Owl Park redeems that code once to
give them a painted egg pet. This file is the contract between the two.

## The hunt (about two minutes for someone who knows SQL)

1. The Home query carries a comment, and the console's Tables list a line,
   saying not every table is listed.
2. `SHOW TABLES` (or `information_schema.tables`) shows `nest_box`.
3. `SELECT * FROM nest_box` shows nine shards and a four-line riddle: match
   each `shard_key` to `products.product_id`, order the shards by
   `list_price` cheapest first, and run what they spell.
4. The shards spell `SELECT claim_egg('speckled-robin');`. The console sees
   the found line and asks `/api/egg/claim` for a code, which it shows with a
   Copy button and keeps in `localStorage` (`sqlc-egg`), so the same browser
   gets the same code back instead of a new one.

The table and the `claim_egg` macro live in `data/console/extra.sql`. The
shard order depends on the Owl Park products' list prices
(`data/playground/generate.py`); if those change, reorder the shards.

## Code format

`EGG-XXXX-XXXX-XXXX-XXXX-XXXX`: 20 Crockford base32 characters (no I, L, O
or U) holding 12 bytes:

| bytes | what |
|---|---|
| 0–4 | random id (shown as 10 hex characters) |
| 5–6 | issue day, days since 2026-01-01 UTC, big-endian |
| 7–11 | first 5 bytes of HMAC-SHA256(`EGG_CODE_SECRET`, `"egg-v1:"` + bytes 0–6) |

Codes don't expire. Verification ignores case, spaces and dashes, and reads
O as 0 and I or L as 1.

## Endpoints (Vercel functions in `api/egg/`)

Both answer JSON with `Cache-Control: no-store`, accept `POST` only, and
return `503 {"error":"not_set_up"}` until `EGG_CODE_SECRET` is set.

- `POST /api/egg/claim` with `{"answer":"speckled-robin"}` →
  `200 {"code":"EGG-…","issued":"YYYY-MM-DD"}`, or `400 {"error":"wrong_answer"}`.
- `POST /api/egg/verify` with `{"code":"EGG-…"}` →
  `200 {"valid":true,"id":"<10 hex>","issued":"YYYY-MM-DD"}` or `200 {"valid":false}`.

Verify is stateless: it proves loganmansfield.org issued the code, not that
it's unused. **Owl Park must store each redeemed `id` and refuse a repeat**;
that is what makes a code work once. Call it from Owl Park's server (it sends
no CORS headers), or verify the HMAC locally with the same secret.

## Limits

This is a game, not a security boundary: the puzzle and the answer are in the
site's public files, and anyone can post the answer to `/claim` for a fresh
code. The HMAC only stops people inventing codes. If codes ever need
rationing, add storage to `/claim` (for example a per-IP limit) rather than
hiding the answer.

## Setup (once, by the site owner)

1. Make a random secret of at least 16 characters, for example
   `openssl rand -base64 32`.
2. Add it in the Vercel project as the environment variable
   `EGG_CODE_SECRET` for Production (and Preview, to try it on preview
   deployments), then redeploy.
3. Give Owl Park the verify URL (`https://loganmansfield.org/api/egg/verify`).
   It needs the secret only if it checks codes itself instead of calling it.

Changing the secret invalidates every code issued under the old one.
