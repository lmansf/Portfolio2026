/* POST /api/egg/claim  {"answer": "<the word from the nest box>"}
 * → 200 {"code": "EGG-…", "kind": "signed"}  once EGG_SIGNING_KEY is set:
 *       a 107-character Ed25519-signed code Owl Park checks with the public key.
 *   200 {"code": "EGG-XXXX-…", "issued": "YYYY-MM-DD", "kind": "hmac"} while
 *       only the older EGG_CODE_SECRET is set (Owl Park doesn't take these).
 *   400 {"error": "wrong_answer"} · 405 · 503 {"error": "not_set_up"} with neither.
 * See docs/egg-codes.md. */
const { ANSWER, secret, issue, readJson, send } = require('./_codes');
const { signingKey, issueSigned } = require('./_signed');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return send(res, 405, { error: 'method_not_allowed' });
    }
    const signer = signingKey();
    const hmacKey = signer ? null : secret();
    if (!signer && !hmacKey) return send(res, 503, { error: 'not_set_up' });
    const { answer } = readJson(req);
    if (typeof answer !== 'string' || answer.trim().toLowerCase() !== ANSWER) {
        return send(res, 400, { error: 'wrong_answer' });
    }
    if (signer) {
        const { code } = issueSigned(signer);
        return send(res, 200, { code, kind: 'signed' });
    }
    const { code, issued } = issue(hmacKey);
    return send(res, 200, { code, issued, kind: 'hmac' });
};
