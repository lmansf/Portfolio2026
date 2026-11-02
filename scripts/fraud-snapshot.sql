-- Fraud pipeline snapshot for loganmansfield.org's live data section.
--
-- Returns ONE row with ONE json column: aggregates only (counts, rates,
-- dollar totals, a score histogram). No row-level values, ids, emails,
-- cards, IPs or names ever leave the database. The data itself is
-- simulated theme-park webstore checkouts.
--
-- Fraud is judged against the generator's answer key (raw_fraud_truth),
-- including labels whose label_available_at is still in the future; the
-- page says so. Unlabeled checkouts count as legitimate.
--
-- Run read-only:  psql "$FRAUD_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f scripts/fraud-snapshot.sql
-- FRAUD_DB_URL should log in as fraud_snapshot_reader (supabase/fraud_snapshot_reader.sql).
-- Days are America/New_York calendar days; the window is the last 30 days.
begin transaction read only;
set local statement_timeout = '60s';

with base as (
  select
    (x.event_ts at time zone 'America/New_York')::date as day,
    d.decision,
    d.score,
    r.fraud_scoring_ms,
    r.total_latency_ms,
    coalesce(r.fraud_timeout, false) as fraud_timeout,
    coalesce(t.is_fraud, false) as is_fraud,
    t.fraud_pattern,
    coalesce(x.total, 0) as total
  from public.raw_transactions x
  join public.raw_fraud_decisions d using (transaction_id)
  left join public.raw_fraud_truth t using (transaction_id)
  left join public.raw_checkout_responses r using (transaction_id)
  where x.event_ts >= now() - interval '30 days'
),
daily as (
  select
    day,
    count(*) as checkouts,
    count(*) filter (where decision = 'approve') as approved,
    count(*) filter (where decision = 'review') as reviewed,
    count(*) filter (where decision = 'decline') as declined,
    count(*) filter (where is_fraud) as fraud,
    count(*) filter (where is_fraud and decision <> 'approve') as fraud_caught,
    count(*) filter (where not is_fraud and decision = 'decline') as false_declines,
    round(sum(total) filter (where is_fraud and decision <> 'approve'), 2)::float8 as fraud_dollars_stopped,
    round(sum(total) filter (where is_fraud and decision = 'approve'), 2)::float8 as fraud_dollars_approved,
    round((percentile_cont(0.95) within group (order by fraud_scoring_ms))::numeric, 1)::float8 as p95_scoring_ms
  from base
  group by day
),
totals as (
  select
    count(*) as checkouts,
    count(*) filter (where decision <> 'approve') as flagged,
    count(*) filter (where decision = 'decline') as declined,
    count(*) filter (where decision = 'review') as reviewed,
    count(*) filter (where is_fraud) as fraud,
    count(*) filter (where is_fraud and decision <> 'approve') as fraud_caught,
    count(*) filter (where not is_fraud and decision = 'decline') as false_declines,
    count(*) filter (where not is_fraud) as legit,
    round(sum(total) filter (where is_fraud and decision <> 'approve'), 2)::float8 as fraud_dollars_stopped,
    round(sum(total) filter (where is_fraud and decision = 'approve'), 2)::float8 as fraud_dollars_approved,
    round((percentile_cont(0.5) within group (order by fraud_scoring_ms))::numeric, 1)::float8 as p50_scoring_ms,
    round((percentile_cont(0.95) within group (order by fraud_scoring_ms))::numeric, 1)::float8 as p95_scoring_ms,
    round((percentile_cont(0.95) within group (order by total_latency_ms))::numeric, 0)::float8 as p95_checkout_ms,
    count(*) filter (where fraud_timeout) as scoring_timeouts,
    count(distinct day) as active_days
  from base
),
bins as (
  select
    least(floor(score * 20)::int, 19) as bin,
    count(*) filter (where not is_fraud) as legit,
    count(*) filter (where is_fraud) as fraud
  from base
  group by 1
),
patterns as (
  select
    fraud_pattern as pattern,
    count(*) as fraud,
    count(*) filter (where decision <> 'approve') as caught
  from base
  where is_fraud and fraud_pattern is not null
  group by 1
),
thresholds as (
  select
    min(score) filter (where decision = 'review') as review_from,
    min(score) filter (where decision = 'decline') as decline_from
  from base
),
models as (
  select string_agg(distinct d.model_version, ', ' order by d.model_version) as model_versions
  from public.raw_fraud_decisions d
  where d.decided_at >= now() - interval '30 days'
)
select json_build_object(
  'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'timezone', 'America/New_York',
  'window_days', 30,
  'simulated', true,
  'model_versions', (select model_versions from models),
  'latest_event_at', (select to_char(max(event_ts) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                        from public.raw_transactions),
  'totals', (select row_to_json(totals) from totals),
  'thresholds', (select row_to_json(thresholds) from thresholds),
  'daily', (select coalesce(json_agg(daily order by day), '[]'::json) from daily),
  'score_bins', (select coalesce(json_agg(json_build_object(
                    'from', round(bin / 20.0, 2)::float8, 'to', round((bin + 1) / 20.0, 2)::float8,
                    'legit', legit, 'fraud', fraud) order by bin), '[]'::json) from bins),
  'patterns', (select coalesce(json_agg(patterns order by fraud desc), '[]'::json) from patterns)
) as snapshot;

commit;
