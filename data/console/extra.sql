-- ── The nest box: a small hunt for people who poke around ──
-- Hand-written (not built from the pages); build_console_data.py appends it
-- to site.sql. No page draws it, and the SQL source editors leave it out of
-- the table names they suggest (HIDDEN_TABLES in assets/sql-source.js), so it
-- turns up only for someone who looks: SHOW ALL TABLES, information_schema,
-- or the comment on the Home toolkit's default query.
--
-- Solving it: join each shard_key to products.product_id, order the shards
-- by list_price (cheapest first), and string them together. They spell a
-- query to run. The trail depends on the Owl Park products' list prices
-- (data/playground/generate.py), which are all different; if those change,
-- reorder the shards here. See docs/egg-codes.md.
CREATE TABLE nest_box (
    shard_key INTEGER,
    shard VARCHAR,
    riddle VARCHAR
);
INSERT INTO nest_box VALUES
    (1, 'obin', 'My keys open the table of things you can buy;'),
    (2, '(''sp', 'match each one to the column that names its id.'),
    (3, 'eckl', 'Then line up my shards from the cheapest to dear,'),
    (4, ''');', 'and run what they spell. The egg will appear.'),
    (5, 'CT c', NULL),
    (6, '_egg', NULL),
    (7, 'ed-r', NULL),
    (8, 'laim', NULL),
    (9, 'SELE', NULL);

-- The query the shards spell calls this. The editor that runs it sees the
-- found line and asks /api/egg/claim for this visitor's one-time egg code.
CREATE MACRO claim_egg(word) AS
    CASE WHEN lower(trim(word)) = 'speckled-robin'
         THEN 'You found the nest.'
         ELSE 'Not quite. Line the shards up from the cheapest product to the dearest.'
    END;
