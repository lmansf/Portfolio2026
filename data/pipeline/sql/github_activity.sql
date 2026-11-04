-- Mart: public GitHub activity per day and repository, last 30 days.
-- Reads the staging table stg_github_events (one row per public event,
-- written by scripts/data_run.py from the GitHub public API).
SELECT
    CAST(timezone('America/New_York', CAST(created_at AS TIMESTAMPTZ)) AS DATE) AS day,
    repo,
    count(*)::INTEGER AS events,
    (count(*) FILTER (WHERE type = 'PushEvent'))::INTEGER AS pushes
FROM stg_github_events
GROUP BY ALL
ORDER BY day, repo;
