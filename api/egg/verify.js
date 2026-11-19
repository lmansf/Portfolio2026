/* POST /api/egg/verify  {"code": "EGG-…"}
 * → 200 {"valid": true, "kind": "signed", "id": "<24 hex>"} for a code signed
 *       with EGG_SIGNING_KEY (Owl Park checks these itself with the public
 *       key and needn't call this);
 *   200 {"valid": true, "kind": "hmac", "id": "<10 hex>", "issued": "YYYY-MM-DD"}
 *       for an older one-time code, while EGG_CODE_SECRET is still set;
 *   200 {"valid": false} for anything else.
 *   503 {"error": "not_set_up"} with neither key set.
 * Stateless: it can't know whether a code was already used. The redeemer
 * (Owl Park) stores the ids it has taken and refuses repeats. */
const { secret, verify, readJson, send } = require('./_codes');
const { signingKey, verifySigned } = require('./_signed');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return send(res, 405, { error: 'method_not_allowed' });
    }
    const signer = signingKey();
    const hmacKey = secret();
    if (!signer && !hmacKey) return send(res, 503, { error: 'not_set_up' });
    const { code } = readJson(req);
    const signed = signer ? verifySigned(signer, code) : null;
    if (signed) return send(res, 200, { valid: true, kind: 'signed', ...signed });
    const old = hmacKey ? verify(hmacKey, code) : null;
    if (old) return send(res, 200, { valid: true, kind: 'hmac', ...old });
    return send(res, 200, { valid: false });
};
