/* POST /api/egg/verify  {"code": "EGG-…"}
 * → 200 {"valid": true, "id": "<10 hex chars>", "issued": "YYYY-MM-DD"}
 *   200 {"valid": false} for anything that isn't a code this site issued.
 * Stateless: it can't know whether a code was already used. The redeemer
 * (Owl Park) stores the ids it has redeemed and refuses repeats. */
const { secret, verify, readJson, send } = require('./_codes');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return send(res, 405, { error: 'method_not_allowed' });
    }
    const key = secret();
    if (!key) return send(res, 503, { error: 'not_set_up' });
    const { code } = readJson(req);
    const found = verify(key, code);
    return send(res, 200, found ? { valid: true, ...found } : { valid: false });
};
