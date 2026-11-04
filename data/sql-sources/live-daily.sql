SELECT
    day, checkouts, reviewed, declined,
    fraud, fraud_caught, false_declines, fraud_dollars_stopped
FROM fraud_daily
ORDER BY day;
