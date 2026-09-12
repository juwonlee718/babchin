alter table public.schedules
  add column weekday smallint,
  add column ends_at time;

-- The previous UI stored only a start time. Preserve existing entries as a
-- Monday 50-minute class so no existing schedule row becomes invalid.
update public.schedules
set weekday = 1,
    ends_at = starts_at + interval '50 minutes'
where weekday is null or ends_at is null;

alter table public.schedules
  alter column weekday set not null,
  alter column ends_at set not null,
  add constraint schedules_weekday_range check (weekday between 1 and 5),
  add constraint schedules_valid_time_range check (ends_at > starts_at),
  add constraint schedules_starts_at_five_minute check (extract(minute from starts_at)::integer % 5 = 0),
  add constraint schedules_ends_at_five_minute check (extract(minute from ends_at)::integer % 5 = 0);

drop index if exists public.schedules_user_time_idx;
create index schedules_user_weekday_time_idx on public.schedules(user_id, weekday, starts_at);
