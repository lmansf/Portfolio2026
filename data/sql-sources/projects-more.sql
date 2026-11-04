SELECT title, badge, eyebrow, year, summary, tags
FROM projects
WHERE NOT featured
ORDER BY sort_order;
