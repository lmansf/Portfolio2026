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
--
-- Two scorers write to this database. The rules engine (model_version
-- 'rules-v0' in raw_fraud_decisions) decides every checkout; it is the only
-- scorer the totals, daily, score_bins and patterns entries describe. The
-- newer real-time model writes to realtime_fraud_audit; the compare,
-- compare_patterns and compare_sweep entries score it and the rules side by
-- side on the same checkouts: the ones the model scored one at a time as
-- they arrived. Other model_version rows in raw_fraud_decisions are left out.
begin transaction read only;
set local statement_timeout = '60s';

with base as (
  select
    x.transaction_id,
    x.event_ts,
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
    and d.model_version = 'rules-v0'
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
    and d.model_version = 'rules-v0'
),
model_scores as (
  -- The real-time model's latest score per checkout (it can re-score one;
  -- transaction_id is text in this table). Its one-off batch run over the
  -- older checkouts on Nov 14 records about 0.003 ms a row (the batch's
  -- time split across its rows) and gave every order nearly the same tiny
  -- score, so the comparison keeps only orders scored one at a time, which
  -- record a real per-order time of a few milliseconds.
  select distinct on (a.transaction_id)
    a.transaction_id,
    a.decision = 'FRAUD_FLAGGED' as model_flagged,
    a.fraud_probability,
    a.latency_ms
  from public.realtime_fraud_audit a
  where a.latency_ms >= 1
  order by a.transaction_id, a.processed_at desc, a.id desc
),
compare_base as (
  -- Checkouts in the window that the model scored one at a time, each with
  -- both scorers' verdicts.
  select b.*, m.model_flagged, m.fraud_probability, m.latency_ms
  from base b
  join model_scores m on m.transaction_id = b.transaction_id::text
),
compare as (
  select
    'rules' as scorer,
    count(*) as checkouts,
    count(*) filter (where is_fraud) as fraud,
    count(*) filter (where not is_fraud) as legit,
    count(*) filter (where decision <> 'approve') as flagged,
    count(*) filter (where is_fraud and decision <> 'approve') as caught,
    round(min(score) filter (where decision <> 'approve')::numeric, 4)::float8 as cutoff,
    round((percentile_cont(0.5) within group (order by fraud_scoring_ms))::numeric, 1)::float8 as p50_ms,
    round((percentile_cont(0.95) within group (order by fraud_scoring_ms))::numeric, 1)::float8 as p95_ms
  from compare_base
  union all
  select
    'model',
    count(*),
    count(*) filter (where is_fraud),
    count(*) filter (where not is_fraud),
    count(*) filter (where model_flagged),
    count(*) filter (where is_fraud and model_flagged),
    round(min(fraud_probability) filter (where model_flagged)::numeric, 4)::float8,
    round((percentile_cont(0.5) within group (order by latency_ms))::numeric, 1)::float8,
    round((percentile_cont(0.95) within group (order by latency_ms))::numeric, 1)::float8
  from compare_base
),
compare_patterns as (
  select fraud_pattern as pattern, 'rules' as scorer, count(*) as fraud,
         count(*) filter (where decision <> 'approve') as caught
  from compare_base
  where is_fraud and fraud_pattern is not null
  group by 1
  union all
  select fraud_pattern, 'model', count(*), count(*) filter (where model_flagged)
  from compare_base
  where is_fraud and fraud_pattern is not null
  group by 1
),
compare_sweep as (
  -- What each scorer would flag at other cutoffs: the rules on their 0-1
  -- risk score, the model on its fraud probability.
  select 'rules' as scorer, c.cutoff::float8 as cutoff,
         count(*) filter (where b.score >= c.cutoff) as flagged,
         count(*) filter (where b.score >= c.cutoff and b.is_fraud) as caught
  from compare_base b
  cross join unnest(array[0.86, 0.7, 0.5, 0.3, 0.2]) as c(cutoff)
  group by c.cutoff
  union all
  select 'model', c.cutoff::float8,
         count(*) filter (where b.fraud_probability >= c.cutoff),
         count(*) filter (where b.fraud_probability >= c.cutoff and b.is_fraud)
  from compare_base b
  cross join unnest(array[0.9, 0.5, 0.1, 0.01, 0.005]) as c(cutoff)
  group by c.cutoff
),
day_one_scores as (
  select distinct on (a.transaction_id)
    a.transaction_id,
    a.decision = 'FRAUD_FLAGGED' as model_flagged
  from public.realtime_fraud_audit a
  where a.latency_ms >= 1
    and a.processed_at < timestamptz '2026-11-15 22:57:41+00'
  order by a.transaction_id, a.processed_at desc, a.id desc
),
compare_day_one as (
  -- The model's first 24 hours live, frozen: checkouts placed from the first
  -- one it scored one at a time after going live (Nov 14, 22:27:41 UTC) to
  -- 24 hours later. (One stray Nov 10 order with a live score is left out.)
  -- The site's copy quotes these counts, so both the order window and a
  -- load/score cutoff (window end plus 30 minutes, Nov 15 22:57:41 UTC) are
  -- fixed: rows loaded and scores recorded after the cutoff (a re-score, a
  -- late label) can't change them. metrics.json claims check the copy
  -- against them every night. It reads the raw tables directly, with its own
  -- latest-score lookup, so it doesn't age out of the 30-day window the rest
  -- of the snapshot uses.
  select
    s.scorer,
    to_char(timestamptz '2026-11-14 22:27:41+00' at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as window_start,
    to_char(timestamptz '2026-11-15 22:27:41+00' at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as window_end,
    count(*) as checkouts,
    count(*) filter (where coalesce(t.is_fraud, false)) as fraud,
    count(*) filter (where not coalesce(t.is_fraud, false)) as legit,
    count(*) filter (where case s.scorer when 'rules' then d.decision <> 'approve' else m.model_flagged end) as flagged,
    count(*) filter (where coalesce(t.is_fraud, false)
                       and case s.scorer when 'rules' then d.decision <> 'approve' else m.model_flagged end) as caught
  from public.raw_transactions x
  join public.raw_fraud_decisions d on d.transaction_id = x.transaction_id and d.model_version = 'rules-v0'
                                    and d.created_at < timestamptz '2026-11-15 22:57:41+00'
  left join public.raw_fraud_truth t on t.transaction_id = x.transaction_id
                                    and t.created_at < timestamptz '2026-11-15 22:57:41+00'
  join day_one_scores m on m.transaction_id = x.transaction_id::text
  cross join (values ('rules'), ('model')) as s(scorer)
  where x.event_ts >= timestamptz '2026-11-14 22:27:41+00'
    and x.event_ts <  timestamptz '2026-11-15 22:27:41+00'
    and x.created_at < timestamptz '2026-11-15 22:57:41+00'
  group by s.scorer
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
  'patterns', (select coalesce(json_agg(patterns order by fraud desc, pattern collate "C"), '[]'::json) from patterns),
  'model_started_at', (select to_char(greatest(min(processed_at), now() - interval '30 days') at time zone 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                         from public.realtime_fraud_audit where latency_ms >= 1),
  'compare', (select coalesce(json_agg(compare order by scorer desc), '[]'::json) from compare),
  'compare_patterns', (select coalesce(json_agg(compare_patterns
                         order by fraud desc, pattern collate "C", scorer desc), '[]'::json)
                       from compare_patterns),
  'compare_sweep', (select coalesce(json_agg(compare_sweep order by scorer desc, cutoff desc), '[]'::json)
                    from compare_sweep),
  'compare_day_one', (select coalesce(json_agg(compare_day_one order by scorer desc), '[]'::json)
                      from compare_day_one)
) as snapshot;

commit;
