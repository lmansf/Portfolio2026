SELECT scorer, checkouts, fraud, legit, flagged, caught, cutoff, p50_ms, p95_ms
FROM fraud_compare
ORDER BY scorer DESC;
