#!/usr/bin/env node
/* Makes the Ed25519 key pair for signed egg codes (docs/egg-codes.md).
 *   node scripts/egg-keypair.js
 * Prints two lines. The private key goes ONLY into Vercel as EGG_SIGNING_KEY;
 * never commit it or paste it anywhere else. The public key is not a secret:
 * it goes into Owl Park as the Worker var EGG_CODE_KEY. */
const crypto = require('crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const jwk = privateKey.export({ format: 'jwk' });
const pub = publicKey.export({ format: 'jwk' }).x;
process.stdout.write(`EGG_SIGNING_KEY (private, Vercel only): ${jwk.d}\n`);
process.stdout.write(`EGG_CODE_KEY    (public, Owl Park):     ${pub}\n`);
