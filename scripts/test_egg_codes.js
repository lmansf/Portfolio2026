/* Tests for the egg code endpoints (docs/egg-codes.md).
 *   node --test scripts/test_egg_codes.js
 * Uses a throwaway key pair made here; no real key is involved. The
 * cross-check re-implements Owl Park's verifyEggCode (WebCrypto Ed25519 over
 * the 13 body bytes, base64url) so a format drift fails here first. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const signed = require(path.join(__dirname, '..', 'api', 'egg', '_signed.js'));
const claim = require(path.join(__dirname, '..', 'api', 'egg', 'claim.js'));
const verify = require(path.join(__dirname, '..', 'api', 'egg', 'verify.js'));

function freshSeed() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    return { d: privateKey.export({ format: 'jwk' }).d, x: publicKey.export({ format: 'jwk' }).x };
}

// The park's check, as packages/shared/src/eggCode.ts does it.
async function parkVerify(text, publicKey) {
    const s = String(text).replace(/\s+/g, '');
    if (s.slice(0, 4).toUpperCase() !== 'EGG-') return null;
    const rest = s.slice(4);
    if (!/^[A-Za-z0-9_-]*$/.test(rest) || rest.length % 4 === 1) return null;
    const bytes = new Uint8Array(Buffer.from(rest, 'base64url'));
    if (bytes.length !== 77 || bytes[0] !== 1) return null;
    const key = await crypto.webcrypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.webcrypto.subtle.verify({ name: 'Ed25519' }, key, bytes.slice(13), bytes.slice(0, 13));
    return ok ? Buffer.from(bytes.slice(1, 13)).toString('hex') : null;
}

function call(handler, { method = 'POST', body } = {}) {
    return new Promise((resolve) => {
        const headers = {};
        const res = {
            statusCode: 200,
            setHeader(k, v) { headers[k.toLowerCase()] = v; },
            end(text) { resolve({ status: this.statusCode, headers, body: text ? JSON.parse(text) : null }); }
        };
        handler({ method, body }, res);
    });
}

function withEnv(env, fn) {
    const keep = { EGG_SIGNING_KEY: process.env.EGG_SIGNING_KEY, EGG_CODE_SECRET: process.env.EGG_CODE_SECRET };
    delete process.env.EGG_SIGNING_KEY;
    delete process.env.EGG_CODE_SECRET;
    Object.assign(process.env, env);
    return Promise.resolve(fn()).finally(() => {
        for (const [k, v] of Object.entries(keep)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    });
}

test('a signed code has the park format and passes the park check', async () => {
    const { d, x } = freshSeed();
    const key = signed.signingKey({ EGG_SIGNING_KEY: d });
    assert.ok(key);
    assert.equal(key.pub, x);
    const { code, id } = signed.issueSigned(key);
    assert.equal(code.length, 107);
    assert.equal(signed.CODE_LENGTH, 107);
    assert.match(code, /^EGG-[A-Za-z0-9_-]{103}$/);
    assert.match(id, /^[0-9a-f]{24}$/);
    assert.equal(await parkVerify(code, x), id);
    // The park also takes a paste with line breaks and a lower-case prefix.
    assert.equal(await parkVerify(`  egg-${code.slice(4, 50)}\n${code.slice(50)} `, x), id);
});

test('each claim is a new code with its own id', () => {
    const key = signed.signingKey({ EGG_SIGNING_KEY: freshSeed().d });
    const a = signed.issueSigned(key);
    const b = signed.issueSigned(key);
    assert.notEqual(a.code, b.code);
    assert.notEqual(a.id, b.id);
});

test('verifySigned refuses edits, other keys and wrong shapes', () => {
    const key = signed.signingKey({ EGG_SIGNING_KEY: freshSeed().d });
    const other = signed.signingKey({ EGG_SIGNING_KEY: freshSeed().d });
    const { code, id } = signed.issueSigned(key);
    assert.deepEqual(signed.verifySigned(key, code), { id });
    assert.deepEqual(signed.verifySigned(key, ` egg-${code.slice(4)}\n`), { id });
    assert.equal(signed.verifySigned(other, code), null);
    const flip = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
    assert.equal(signed.verifySigned(key, flip), null);
    assert.equal(signed.verifySigned(key, code.slice(0, -1)), null);
    assert.equal(signed.verifySigned(key, 'EGG-' + Buffer.concat([Buffer.from([2]), Buffer.from(code.slice(4), 'base64url').subarray(1)]).toString('base64url')), null);
    for (const bad of [null, 42, '', 'EGG-', 'EGG-ABCD-EFGH', 'x'.repeat(500)]) assert.equal(signed.verifySigned(key, bad), null);
});

test('signingKey takes only a 43-character base64url seed and refuses the park test key', () => {
    assert.equal(signed.signingKey({}), null);
    assert.equal(signed.signingKey({ EGG_SIGNING_KEY: 'short' }), null);
    assert.equal(signed.signingKey({ EGG_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----' }), null);
    assert.ok(signed.signingKey({ EGG_SIGNING_KEY: `  ${freshSeed().d}\n` }));
    assert.equal(signed.TEST_PUBLIC_KEY, '_ili8TFx3evauC6V4pG3LCCXi3wCHKHqte9N59mFP9I');
});

test('claim and verify: signed when EGG_SIGNING_KEY is set', () => withEnv({ EGG_SIGNING_KEY: freshSeed().d, EGG_CODE_SECRET: 'an-older-secret-of-enough-length' }, async () => {
    const wrong = await call(claim, { body: { answer: 'blue-jay' } });
    assert.equal(wrong.status, 400);
    const got = await call(claim, { body: { answer: ' Speckled-Robin ' } });
    assert.equal(got.status, 200);
    assert.equal(got.body.kind, 'signed');
    assert.equal(got.body.code.length, 107);
    assert.equal(got.headers['cache-control'], 'no-store');
    const ok = await call(verify, { body: { code: got.body.code } });
    assert.deepEqual(Object.keys(ok.body).sort(), ['id', 'kind', 'valid']);
    assert.equal(ok.body.valid, true);
    assert.equal(ok.body.kind, 'signed');
    const no = await call(verify, { body: { code: got.body.code.slice(0, -2) + 'AA' } });
    assert.deepEqual(no.body, { valid: false });
}));

test('claim and verify: older HMAC codes until the signing key exists', () => withEnv({ EGG_CODE_SECRET: 'an-older-secret-of-enough-length' }, async () => {
    const got = await call(claim, { body: { answer: 'speckled-robin' } });
    assert.equal(got.status, 200);
    assert.equal(got.body.kind, 'hmac');
    assert.match(got.body.code, /^EGG-[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
    const ok = await call(verify, { body: { code: got.body.code } });
    assert.equal(ok.body.valid, true);
    assert.equal(ok.body.kind, 'hmac');
}));

test('claim and verify answer 503 with no key, 405 for GET', () => withEnv({}, async () => {
    assert.equal((await call(claim, { body: { answer: 'speckled-robin' } })).status, 503);
    assert.equal((await call(verify, { body: { code: 'EGG-x' } })).status, 503);
    assert.equal((await call(claim, { method: 'GET' })).status, 405);
}));

test('the key script prints a pair that works together', () => {
    const out = require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'egg-keypair.js')], { encoding: 'utf8' });
    const priv = /EGG_SIGNING_KEY[^:]*:\s*(\S+)/.exec(out)[1];
    const pub = /EGG_CODE_KEY[^:]*:\s*(\S+)/.exec(out)[1];
    const key = signed.signingKey({ EGG_SIGNING_KEY: priv });
    assert.ok(key);
    assert.equal(key.pub, pub);
    assert.equal(pub.length, 43);
});
