# Egg codes (the nest-box hunt)

A visitor who finds the hidden `nest_box` table from any "SQL source" editor
on the site and solves it gets a signed **egg code**. Owl Park redeems that
code once to give them a painted egg pet. This file is the contract between
the two.

## The hunt (about two minutes for someone who knows SQL)

Every "SQL source" caption on Home, Projects and `/live` opens to an editor
that runs SQL in the browser (`assets/sql-source.js`), and every editor can
query every table, so the hunt can start from any of them.

1. The Home toolkit's default query opens with a comment: not every table
   makes it onto a page, and `SHOW ALL TABLES` lists them.
2. `SHOW ALL TABLES` (or `information_schema.tables`) shows `nest_box`, and
   the Owl Park sample tables under `owl_park`. The editors' error hints
   never name `nest_box`.
3. `SELECT * FROM nest_box` shows nine shards and a four-line riddle: match
   each `shard_key` to `products.product_id`, order the shards by
   `list_price` cheapest first, and run what they spell.
4. The shards spell `SELECT claim_egg('speckled-robin');`. The editor sees
   the found line and asks `/api/egg/claim` for a code, which it shows with a
   Copy button and keeps in `localStorage` (`sqlc-egg`), so the same browser
   gets the same code back instead of a new one.

The table and the `claim_egg` macro live in `data/console/extra.sql`. The
shard order depends on the Owl Park products' list prices
(`data/playground/generate.py`); if those change, reorder the shards.

## Code format (signed, Owl Park ticket OP-260)

The site signs each code with an **Ed25519 private key** that lives only in
Vercel (`EGG_SIGNING_KEY`). Owl Park holds only the public key, so the park
can check a code but can never make one. The format is the park's
(`packages/shared/src/eggCode.ts` in Welcome-to-Owl-Park) and must stay
byte-for-byte the same:

| part | what |
|---|---|
| body | 13 bytes: byte 0 is the version (`1`), bytes 1–12 a random id (CSPRNG) |
| signature | Ed25519 over the 13 body bytes exactly, no prefix or context string |
| code | `EGG-` + base64url without padding of body ‖ signature (77 bytes): **107 characters**, case-sensitive, no grouping |
| id | the 12 random bytes as 24 lowercase hex characters (the park's ledger key) |

One code per solve, and codes never expire. A code is too long to type, so the
site shows it with a Copy button and the park's **Menu › Settings › Redeem a
code** panel takes a paste (it drops whitespace and reads the `EGG-` prefix
in any case). A code is never carried in a link.

`node --test scripts/test_egg_codes.js` checks the format against a copy of
the park's verify logic.

### Older one-time codes (before the signing key is set)

Until `EGG_SIGNING_KEY` exists, `/claim` keeps issuing the older HMAC codes
if `EGG_CODE_SECRET` is set: `EGG-XXXX-XXXX-XXXX-XXXX-XXXX`, 20 Crockford
base32 characters holding a 5-byte random id, a 2-byte issue day (days since
2026-01-01 UTC) and the first 5 bytes of HMAC-SHA256(`EGG_CODE_SECRET`,
`"egg-v1:"` + those 7 bytes). **Owl Park does not take these.** Once the
signing key is set, `/claim` issues only signed codes, and a browser that
kept an older code claims a signed one the next time the hunt is solved.

## Endpoints (Vercel functions in `api/egg/`)

Both answer JSON with `Cache-Control: no-store`, accept `POST` only, and
return `503 {"error":"not_set_up"}` while neither key is set.

- `POST /api/egg/claim` with `{"answer":"speckled-robin"}` →
  `200 {"code":"EGG-…","kind":"signed"}` (or, with only the older secret,
  `{"code":"EGG-…","issued":"YYYY-MM-DD","kind":"hmac"}`), or
  `400 {"error":"wrong_answer"}`.
- `POST /api/egg/verify` with `{"code":"EGG-…"}` →
  `200 {"valid":true,"kind":"signed","id":"<24 hex>"}`,
  `200 {"valid":true,"kind":"hmac","id":"<10 hex>","issued":"YYYY-MM-DD"}`, or
  `200 {"valid":false}`.

Owl Park checks signed codes itself with the public key and doesn't need
`/verify`; it stays for anyone checking a code by hand. Verify is stateless:
it proves the site signed the code, not that it's unused. **Owl Park stores
each redeemed id and refuses a repeat**; that is what makes a code work once.

## Limits

This is a game, not a security boundary: the puzzle and the answer are in the
site's public files, and anyone can post the answer to `/claim` for a fresh
code. The signature only stops people inventing codes; each owl can hold one
egg and each code works once in the park, which is the real limit. If codes ever need
rationing, add storage to `/claim` (for example a per-IP limit) rather than
hiding the answer.

## Setup (once, by the site owner)

1. On your own computer, in this repository, run
   `node scripts/egg-keypair.js`. It prints two lines: `EGG_SIGNING_KEY`
   (private, 43 characters) and `EGG_CODE_KEY` (public, 43 characters).
2. In the Vercel project, add the environment variable `EGG_SIGNING_KEY`
   with the private value for Production (and Preview, to try it on preview
   deployments), mark it Sensitive, and redeploy. Never commit it or paste it
   anywhere else.
3. In Owl Park, set the Worker var `EGG_CODE_KEY` to the public value (it
   isn't a secret). The park answers "closed" while that var is unset, and it
   refuses its own test key (`_ili8TFx…`).
4. `EGG_CODE_SECRET` can be removed from Vercel once the signing key is in;
   nothing the park takes depends on it.

Changing the key pair invalidates every code signed with the old one, so make
it once and keep the private value safe (a password manager is fine).
