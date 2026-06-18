-- ============================================================
--  キープアライブ用：匿名でも叩ける軽量関数
--  これを1回だけ Supabase の SQL Editor で実行してください。
--  （schema.sql を実行済みでも、追加でこれだけ流せばOK）
-- ============================================================
create or replace function ping() returns text
language sql security definer set search_path = public as $$
  select 'ok'::text;
$$;

grant execute on function ping() to anon, authenticated;
