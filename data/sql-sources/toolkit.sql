SELECT category, list(skill ORDER BY sort_order) AS skills
FROM skills
GROUP BY category
ORDER BY min(sort_order);
