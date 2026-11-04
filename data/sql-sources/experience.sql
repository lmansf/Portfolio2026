SELECT
    role,
    note,
    concat_ws(' · ', org, location) AS org,
    strftime(started, '%b %Y') || ' – '
        || coalesce(strftime(ended, '%b %Y'), 'present') AS dates,
    summary
FROM experience
ORDER BY started DESC, sort_order;
