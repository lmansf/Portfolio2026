/* Egg codes: one per finder of the SQL console's nest-box hunt.
 *
 * A code is EGG-XXXX-XXXX-XXXX-XXXX-XXXX (Crockford base32, 20 characters)
 * holding 12 bytes: a random 5-byte id, the issue day as 2 bytes (days since
 * 2026-01-01, UTC), and the first 5 bytes of an HMAC-SHA256 over the first 7,
 * keyed with EGG_CODE_SECRET. Codes are stateless: verify checks the MAC and
 * returns the id; whoever redeems a code (Owl Park) keeps the ids it has
 * already redeemed, so each code works once. See docs/egg-codes.md.
 *
 * Files starting with "_" in /api are not routes on Vercel. */
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;
const ANSWER = 'speckled-robin';

function secret() {
    const s = process.env.EGG_CODE_SECRET;
    return s && s.length >= 16 ? s : null;
}

function mac(key, bytes) {
    return crypto.createHmac('sha256', key).update('egg-v1:').update(bytes).digest().subarray(0, 5);
}

function encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const b of buf) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
        value &= (1 << bits) - 1;
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

function decode(str) {
    let bits = 0, value = 0;
    const out = [];
    for (const ch of str) {
        const i = ALPHABET.indexOf(ch);
        if (i < 0) return null;
        value = (value << 5) | i;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
        value &= (1 << bits) - 1;
    }
    if (value !== 0) return null; // padding bits must be zero: one spelling per code
    return Buffer.from(out);
}

function dayString(n) {
    return new Date(EPOCH + n * DAY_MS).toISOString().slice(0, 10);
}

function issue(key, now = Date.now()) {
    const body = Buffer.alloc(7);
    crypto.randomBytes(5).copy(body, 0);
    body.writeUInt16BE(Math.max(0, Math.floor((now - EPOCH) / DAY_MS)), 5);
    const chars = encode(Buffer.concat([body, mac(key, body)]));
    return { code: `EGG-${chars.match(/.{4}/g).join('-')}`, id: body.subarray(0, 5).toString('hex'), issued: dayString(body.readUInt16BE(5)) };
}

// Forgiving about case, spaces, dashes and the usual look-alikes (O→0, I/L→1).
function normalise(code) {
    if (typeof code !== 'string' || code.length > 64) return null;
    let s = code.toUpperCase().replace(/[\s-]/g, '');
    if (s.startsWith('EGG')) s = s.slice(3);
    s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
    return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(s) ? s : null;
}

function verify(key, code) {
    const s = normalise(code);
    if (!s) return null;
    const buf = decode(s);
    if (!buf || buf.length !== 12) return null;
    const body = buf.subarray(0, 7);
    if (!crypto.timingSafeEqual(mac(key, body), buf.subarray(7, 12))) return null;
    return { id: body.subarray(0, 5).toString('hex'), issued: dayString(body.readUInt16BE(5)) };
}

function readJson(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { return {}; }
    }
    return {};
}

function send(res, status, obj) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
}

module.exports = { ANSWER, secret, issue, verify, normalise, readJson, send };
