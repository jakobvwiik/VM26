-- ============================================================
--  Flytt alle kamptider +2 timer (retter tidssone til norsk tid)
--  Kjør DENNE én gang i Supabase SQL Editor hvis kampene
--  allerede ligger i databasen med gamle tider.
--  Trygt å kjøre – men kjør KUN ÉN gang (ellers flyttes +2t igjen).
-- ============================================================
update matches
set
  match_date = ((match_date || ' ' || match_time)::timestamp + interval '2 hours')::date,
  match_time = to_char(((match_date || ' ' || match_time)::timestamp + interval '2 hours'), 'HH24:MI')
where match_time is not null and match_date is not null;
