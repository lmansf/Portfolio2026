create or replace function public.reserve_event_spots(
    p_event_id text,
    p_quantity integer
)
returns table (
    event_id text,
    capacity integer,
    spots_purchased integer,
    remaining integer,
    reserved integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    requested_quantity integer := greatest(coalesce(p_quantity, 0), 0);
begin
    if requested_quantity <= 0 then
        raise exception 'INVALID_QUANTITY';
    end if;

    update public.events e
    set spots_purchased = coalesce(e.spots_purchased, 0) + requested_quantity
    where e.id::text = p_event_id
      and coalesce(e.spots_purchased, 0) + requested_quantity <= e.capacity
    returning
        e.id::text,
        e.capacity,
        coalesce(e.spots_purchased, 0),
        greatest(e.capacity - coalesce(e.spots_purchased, 0), 0),
        requested_quantity
    into event_id, capacity, spots_purchased, remaining, reserved;

    if found then
        return next;
        return;
    end if;

    if not exists (
        select 1
        from public.events e
        where e.id::text = p_event_id
    ) then
        raise exception 'EVENT_NOT_FOUND';
    end if;

    if exists (
        select 1
        from public.events e
        where e.id::text = p_event_id
          and coalesce(e.spots_purchased, 0) + requested_quantity > e.capacity
    ) then
        raise exception 'INSUFFICIENT_CAPACITY';
    end if;

    raise exception 'RESERVATION_CONFLICT';
end;
$$;

grant execute on function public.reserve_event_spots(text, integer) to anon, authenticated;
