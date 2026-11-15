SELECT pattern, scorer, fraud, caught
FROM fraud_compare_patterns
ORDER BY fraud DESC, pattern, scorer DESC;
