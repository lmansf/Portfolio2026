-- Least-privilege login for the daily fraud snapshot job (.github/workflows/fraud-snapshot.yml).
--
-- NOT APPLIED. Run it once yourself in the Supabase SQL editor, after
-- replacing the password placeholder with a long random one.
--
-- What the role can do:
--   * log in and run read-only transactions only;
--   * SELECT the few columns scripts/fraud-snapshot.sql reads from the four
--     raw tables: ids to join on, timestamps, the decision, score and model
--     version, the fraud label and pattern, the order total, and timings.
--     It cannot read email, phone, card, IP, billing or payload columns;
--   * nothing else: no writes, no other tables, no other schemas.
--
-- RLS stays on. The tables have no policies today, so the new role gets one
-- SELECT policy per table that applies to it alone; anon and authenticated
-- are not affected.
--
-- Afterwards, set the repo secret FRAUD_DB_URL to the Session pooler string
-- with this role's user and password (Supabase: Connect, then Session pooler):
--   postgresql://fraud_snapshot_reader.<project-ref>:<password>@<pooler-host>:5432/postgres

create role fraud_snapshot_reader
    login
    password 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD'
    nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
    connection limit 2;

alter role fraud_snapshot_reader set default_transaction_read_only = on;
alter role fraud_snapshot_reader set statement_timeout = '60s';

grant usage on schema public to fraud_snapshot_reader;

grant select (transaction_id, event_ts, total)
    on public.raw_transactions to fraud_snapshot_reader;
grant select (transaction_id, decided_at, decision, score, model_version)
    on public.raw_fraud_decisions to fraud_snapshot_reader;
grant select (transaction_id, is_fraud, fraud_pattern)
    on public.raw_fraud_truth to fraud_snapshot_reader;
grant select (transaction_id, fraud_scoring_ms, total_latency_ms, fraud_timeout)
    on public.raw_checkout_responses to fraud_snapshot_reader;

create policy fraud_snapshot_reader_select on public.raw_transactions
    for select to fraud_snapshot_reader using (true);
create policy fraud_snapshot_reader_select on public.raw_fraud_decisions
    for select to fraud_snapshot_reader using (true);
create policy fraud_snapshot_reader_select on public.raw_fraud_truth
    for select to fraud_snapshot_reader using (true);
create policy fraud_snapshot_reader_select on public.raw_checkout_responses
    for select to fraud_snapshot_reader using (true);

-- To undo:
--   drop policy fraud_snapshot_reader_select on public.raw_transactions;
--   drop policy fraud_snapshot_reader_select on public.raw_fraud_decisions;
--   drop policy fraud_snapshot_reader_select on public.raw_fraud_truth;
--   drop policy fraud_snapshot_reader_select on public.raw_checkout_responses;
--   revoke all on all tables in schema public from fraud_snapshot_reader;
--   revoke usage on schema public from fraud_snapshot_reader;
--   drop role fraud_snapshot_reader;
