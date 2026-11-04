/* POST /api/egg/claim  {"answer": "<the word from the nest box>"}
 * → 200 {"code": "EGG-…", "issued": "YYYY-MM-DD"}
 *   400 {"error": "wrong_answer"} · 405 · 503 {"error": "not_set_up"} until
 *   EGG_CODE_SECRET is set in the Vercel project. */
const { ANSWER, secret, issue, readJson, send } = require('./_codes');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return send(res, 405, { error: 'method_not_allowed' });
    }
    const key = secret();
    if (!key) return send(res, 503, { error: 'not_set_up' });
    const { answer } = readJson(req);
    if (typeof answer !== 'string' || answer.trim().toLowerCase() !== ANSWER) {
        return send(res, 400, { error: 'wrong_answer' });
    }
    const { code, issued } = issue(key);
    return send(res, 200, { code, issued });
};
