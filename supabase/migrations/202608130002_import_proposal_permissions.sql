-- v0.7: authenticated users may manage import proposals within existing owner RLS.
grant select, insert, update, delete on public.import_proposals to authenticated;
