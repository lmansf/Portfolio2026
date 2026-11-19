/* Signed egg codes (Owl Park ticket OP-260). The site signs each code with an
 * Ed25519 private key that lives only in Vercel (EGG_SIGNING_KEY); Owl Park
 * holds only the public key, so the park can check a code but never make one.
 *
 * The format is the park's (packages/shared/src/eggCode.ts in
 * Welcome-to-Owl-Park) and must stay byte-for-byte the same:
 *   body  = 13 bytes: version 1, then a 12-byte random id
 *   sig   = Ed25519 over the 13 body bytes, no prefix or context
 *   code  = "EGG-" + base64url, no padding, of body || sig  (107 characters)
 *   id    = the 12 random bytes as 24 lowercase hex (the park's ledger key)
 * See docs/egg-codes.md. Files starting with "_" in /api are not routes. */
const crypto = require('crypto');

const PREFIX = 'EGG-';
const VERSION = 1;
const ID_BYTES = 12;
const BODY_BYTES = 1 + ID_BYTES;
const SIG_BYTES = 64;
const CODE_LENGTH = PREFIX.length + Math.ceil(((BODY_BYTES + SIG_BYTES) * 4) / 3); // 107

// The park's offline test key: its private half is public in the park's
// repository, so the site refuses to sign with it (and the park refuses it too).
const TEST_PUBLIC_KEY = '_ili8TFx3evauC6V4pG3LCCXi3wCHKHqte9N59mFP9I';

// PKCS#8 DER wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** EGG_SIGNING_KEY: the 32-byte private seed in base64url (43 characters),
 *  as scripts/egg-keypair.js prints it. Null when unset or unusable. */
function signingKey(env = process.env) {
    const raw = (env.EGG_SIGNING_KEY || '').trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const seed = Buffer.from(raw, 'base64url');
    if (seed.length !== 32) return null;
    try {
        const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
        const publicKey = crypto.createPublicKey(privateKey);
        const pub = publicKey.export({ format: 'jwk' }).x;
        if (pub === TEST_PUBLIC_KEY) return null;
        return { privateKey, publicKey, pub };
    } catch {
        return null;
    }
}

function issueSigned(key) {
    const body = Buffer.alloc(BODY_BYTES);
    body[0] = VERSION;
    crypto.randomBytes(ID_BYTES).copy(body, 1);
    const sig = crypto.sign(null, body, key.privateKey);
    return { code: PREFIX + Buffer.concat([body, sig]).toString('base64url'), id: body.subarray(1).toString('hex') };
}

// Read the way the park reads it: whitespace dropped, the prefix in any case,
// the rest strict base64url of exactly 77 bytes with version 1.
function parseSigned(text) {
    if (typeof text !== 'string' || text.length > 400) return null;
    const s = text.replace(/\s+/g, '');
    if (s.slice(0, PREFIX.length).toUpperCase() !== PREFIX) return null;
    const rest = s.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(rest) || rest.length % 4 === 1) return null;
    const bytes = Buffer.from(rest, 'base64url');
    if (bytes.length !== BODY_BYTES + SIG_BYTES || bytes[0] !== VERSION) return null;
    if (bytes.toString('base64url') !== rest) return null; // one spelling per code
    return { body: bytes.subarray(0, BODY_BYTES), sig: bytes.subarray(BODY_BYTES), id: bytes.subarray(1, BODY_BYTES).toString('hex') };
}

function verifySigned(key, text) {
    const parts = parseSigned(text);
    if (!parts) return null;
    try {
        return crypto.verify(null, parts.body, key.publicKey, parts.sig) ? { id: parts.id } : null;
    } catch {
        return null;
    }
}

module.exports = { PREFIX, CODE_LENGTH, TEST_PUBLIC_KEY, signingKey, issueSigned, parseSigned, verifySigned };
