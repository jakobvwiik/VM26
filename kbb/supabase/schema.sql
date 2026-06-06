-- ============================================================
--  Kælles ball og bong — database schema
--  Run this in Supabase → SQL Editor BEFORE seed_matches.sql
-- ============================================================

-- Hvem er admin? Sett admin-e-postene her (må matche lib/config.js ADMIN_EMAILS).
-- (Brukes av RLS-policyene under.)
create or replace function public.is_admin_email(addr text) returns boolean
  language sql immutable as $$
    select lower(coalesce(addr,'')) in ('henrik.kalv@gmail.com', 'jakobwii@gmail.com')
  $$;
-- Bakoverkompatibel: returnerer den primære admin-e-posten
create or replace function public.admin_email() returns text
  language sql immutable as $$ select 'henrik.kalv@gmail.com' $$;

-- ---------- profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  nick text,
  paid boolean default false,
  paid_at timestamptz,
  created_at timestamptz default now()
);
-- if profiles already exists from an earlier run, add the columns:
alter table profiles add column if not exists paid boolean default false;
alter table profiles add column if not exists paid_at timestamptz;
alter table profiles add column if not exists accepted_terms boolean default false;

-- auto-create a profile row when someone signs up
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, nick, paid, paid_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'nick',
    coalesce((new.raw_user_meta_data->>'paid')::boolean, false),
    case when (new.raw_user_meta_data->>'paid')::boolean then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- matches ----------
create table if not exists matches (
  id bigserial primary key,
  match_no int unique not null,
  stage text not null,
  match_date date,
  match_time text,
  home text not null,
  away text not null,
  result_home int,
  result_away int,
  locked_manual boolean default false
);
-- if matches already exists from an earlier run, add the column:
alter table matches add column if not exists locked_manual boolean default false;

-- which stages are double points: single-row jsonb {stage:true}
create table if not exists double_stages (
  id int primary key default 1,
  stages jsonb default '{}'::jsonb
);
insert into double_stages (id) values (1) on conflict do nothing;

-- snapshot of leaderboard ranks (for movement arrows), single row {email_or_id: rank}
create table if not exists rank_snapshot (
  id int primary key default 1,
  ranks jsonb default '{}'::jsonb
);
insert into rank_snapshot (id) values (1) on conflict do nothing;

-- ---------- predictions ----------
create table if not exists predictions (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  pred_home int,
  pred_away int,
  pred_home_team text,
  pred_away_team text,
  updated_at timestamptz default now(),
  primary key (user_id, match_id)
);
alter table predictions add column if not exists pred_home_team text;
alter table predictions add column if not exists pred_away_team text;

-- ---------- submissions (lock state) ----------
create table if not exists submissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  submitted boolean default false,
  locked boolean default false,
  submitted_at timestamptz
);

-- ---------- scoring rules (single row) ----------
create table if not exists scoring_rules (
  id int primary key default 1,
  exact_pts int default 3,
  outcome_pts int default 1,
  wrong_pts int default 0
);
insert into scoring_rules (id) values (1) on conflict do nothing;

-- ---------- bonus predictions (one row per user) ----------
-- yn: jsonb object {0:'ja'|'nei',...}; teams: jsonb array of 8 team names;
-- the three guess fields are free text.
create table if not exists bonus_predictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  yn jsonb default '{}'::jsonb,
  teams jsonb default '[]'::jsonb,
  picks jsonb default '{}'::jsonb,
  top_scorer text,
  top_assist text,
  top_keeper text,
  updated_at timestamptz default now()
);
alter table bonus_predictions add column if not exists picks jsonb default '{}'::jsonb;

-- ---------- bonus answers (admin-set correct answers, single row) ----------
create table if not exists bonus_answers (
  id int primary key default 1,
  yn jsonb default '{}'::jsonb,
  teams jsonb default '[]'::jsonb,
  picks jsonb default '{}'::jsonb,
  top_scorer text,
  top_assist text,
  top_keeper text
);
alter table bonus_answers add column if not exists picks jsonb default '{}'::jsonb;
insert into bonus_answers (id) values (1) on conflict do nothing;

-- ---------- bonus scoring rules (single row, admin-editable) ----------
create table if not exists bonus_rules (
  id int primary key default 1,
  yn int default 5,
  guess int default 5,
  intop8 int default 1,
  exactpos int default 4
);
insert into bonus_rules (id) values (1) on conflict do nothing;

-- ============================================================
--  Time-lock helpers (Norwegian time, CEST = GMT+2)
--  A match locks 3h before kickoff; bonus locks 11 June 18:00 NO.
--  These run server-side so players cannot bypass them.
-- ============================================================
create or replace function public.is_match_locked(mid bigint) returns boolean
  language sql stable as $$
  select case
    when md.locked_manual then true   -- admin nødlås (backup)
    when md.match_date is null or md.match_time is null then false
    else now() >= ((md.match_date || ' ' || md.match_time)::timestamp
                   at time zone 'Europe/Oslo')
  end
  from matches md where md.id = mid
$$;

create or replace function public.is_bonus_locked() returns boolean
  language sql stable as $$
  select now() >= (timestamp '2026-06-11 18:00' at time zone 'Europe/Oslo')
$$;

create or replace function public.is_admin() returns boolean
  language sql stable as $$ select is_admin_email(auth.jwt()->>'email') $$;

-- ============================================================
--  Row Level Security
-- ============================================================
alter table profiles            enable row level security;
alter table matches             enable row level security;
alter table predictions         enable row level security;
alter table submissions         enable row level security;
alter table scoring_rules       enable row level security;
alter table bonus_predictions   enable row level security;
alter table bonus_answers       enable row level security;
alter table bonus_rules         enable row level security;
alter table double_stages       enable row level security;
alter table rank_snapshot       enable row level security;

-- profiles: everyone signed in can read (for leaderboard); you edit only yourself
drop policy if exists "profiles read"   on profiles;
drop policy if exists "profiles upsert" on profiles;
drop policy if exists "profiles update" on profiles;
create policy "profiles read"   on profiles for select to authenticated using (true);
create policy "profiles upsert" on profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles update" on profiles for update to authenticated using (auth.uid() = id or is_admin());
-- admin can delete any player's profile (predictions/bonus cascade via FK on delete)
drop policy if exists "profiles admin del" on profiles;
create policy "profiles admin del" on profiles for delete to authenticated using (is_admin());
drop policy if exists "pred admin del" on predictions;
create policy "pred admin del" on predictions for delete to authenticated using (is_admin());
drop policy if exists "bp admin del" on bonus_predictions;
create policy "bp admin del" on bonus_predictions for delete to authenticated using (is_admin());

-- matches: everyone reads; only admin writes (add/edit/results)
drop policy if exists "matches read"  on matches;
drop policy if exists "matches write" on matches;
drop policy if exists "matches ins"   on matches;
drop policy if exists "matches del"   on matches;
create policy "matches read"  on matches for select to authenticated using (true);
create policy "matches write" on matches for update to authenticated
  using (is_admin_email(auth.jwt()->>'email'));
create policy "matches ins"   on matches for insert to authenticated
  with check (is_admin_email(auth.jwt()->>'email'));
create policy "matches del"   on matches for delete to authenticated
  using (is_admin_email(auth.jwt()->>'email'));

-- predictions: everyone reads (leaderboard transparency); you write only your own,
-- and only while that match is NOT locked (3h before kickoff). Admin can always write.
drop policy if exists "pred read"   on predictions;
drop policy if exists "pred write"  on predictions;
drop policy if exists "pred update" on predictions;
create policy "pred read" on predictions for select to authenticated using (true);
create policy "pred write" on predictions for insert to authenticated
  with check (
    is_admin() or (auth.uid() = user_id and not is_match_locked(match_id))
  );
create policy "pred update" on predictions for update to authenticated
  using (
    is_admin() or (auth.uid() = user_id and not is_match_locked(match_id))
  );

-- submissions: you read/insert/update your own; admin can update anyone's (to reopen)
drop policy if exists "sub read"        on submissions;
drop policy if exists "sub write"       on submissions;
drop policy if exists "sub update"      on submissions;
drop policy if exists "sub admin update" on submissions;
create policy "sub read"   on submissions for select to authenticated using (true);
create policy "sub write"  on submissions for insert to authenticated with check (auth.uid() = user_id);
create policy "sub update" on submissions for update to authenticated using (auth.uid() = user_id);
create policy "sub admin update" on submissions for update to authenticated
  using (is_admin_email(auth.jwt()->>'email'));

-- scoring rules: everyone reads; only admin edits
drop policy if exists "rules read"  on scoring_rules;
drop policy if exists "rules write" on scoring_rules;
create policy "rules read"  on scoring_rules for select to authenticated using (true);
create policy "rules write" on scoring_rules for update to authenticated
  using (is_admin_email(auth.jwt()->>'email'));

-- bonus predictions: everyone reads (leaderboard); you write your own only before the
-- bonus deadline (11 June 18:00 NO). Admin can always write.
drop policy if exists "bp read"   on bonus_predictions;
drop policy if exists "bp write"  on bonus_predictions;
drop policy if exists "bp update" on bonus_predictions;
create policy "bp read" on bonus_predictions for select to authenticated using (true);
create policy "bp write" on bonus_predictions for insert to authenticated
  with check ( is_admin() or (auth.uid() = user_id and not is_bonus_locked()) );
create policy "bp update" on bonus_predictions for update to authenticated
  using ( is_admin() or (auth.uid() = user_id and not is_bonus_locked()) );

-- bonus answers (fasit): everyone reads; only admin edits
drop policy if exists "ba read"  on bonus_answers;
drop policy if exists "ba write" on bonus_answers;
create policy "ba read"  on bonus_answers for select to authenticated using (true);
create policy "ba write" on bonus_answers for update to authenticated
  using (is_admin_email(auth.jwt()->>'email'));

-- bonus rules: everyone reads; only admin edits
drop policy if exists "brules read"  on bonus_rules;
drop policy if exists "brules write" on bonus_rules;
create policy "brules read"  on bonus_rules for select to authenticated using (true);
create policy "brules write" on bonus_rules for update to authenticated
  using (is_admin_email(auth.jwt()->>'email'));

-- double stages: everyone reads; only admin edits
drop policy if exists "dbl read"  on double_stages;
drop policy if exists "dbl write" on double_stages;
create policy "dbl read"  on double_stages for select to authenticated using (true);
create policy "dbl write" on double_stages for update to authenticated using (is_admin());

-- rank snapshot: everyone reads; only admin edits
drop policy if exists "rs read"  on rank_snapshot;
drop policy if exists "rs write" on rank_snapshot;
create policy "rs read"  on rank_snapshot for select to authenticated using (true);
create policy "rs write" on rank_snapshot for update to authenticated using (is_admin());
