-- ============================================================
--  倉庫 貸出・返却 管理アプリ  —  Supabase スキーマ
--  Supabase SQL Editor にこの内容を貼り付けて実行してください。
-- ============================================================

create extension if not exists pgcrypto;

-- 役割
do $$ begin
  create type user_role as enum ('admin', 'general');
exception when duplicate_object then null; end $$;

-- ---------- プロフィール（auth.users と 1:1） ----------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  department  text default '',
  role        user_role not null default 'general',
  created_at  timestamptz not null default now()
);

-- ---------- 物品マスタ ----------
create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  item_code   text unique not null,
  name        text not null,
  category    text default '',
  total_qty   integer not null check (total_qty >= 0),
  stock       integer not null check (stock >= 0),
  location    text default '',
  unit        text default '個',
  created_at  timestamptz not null default now(),
  constraint stock_le_total check (stock <= total_qty)
);

-- ---------- 貸出トランザクション ----------
create table if not exists loans (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete restrict,
  user_id      uuid not null references profiles(id) on delete restrict,
  qty          integer not null check (qty > 0),
  returned_qty integer not null default 0 check (returned_qty >= 0),
  due_date     date,
  lent_at      timestamptz not null default now(),
  returned_at  timestamptz,
  note         text default '',
  constraint returned_le_qty check (returned_qty <= qty)
);
create index if not exists idx_loans_item on loans(item_id);
create index if not exists idx_loans_user on loans(user_id);
create index if not exists idx_loans_open on loans(item_id) where returned_qty < qty;

-- ---------- ステータス付きビュー ----------
create or replace view loans_view as
select l.*,
  (l.returned_qty >= l.qty) as is_closed,
  (l.returned_qty < l.qty and l.due_date is not null and l.due_date < current_date) as is_overdue,
  case when l.returned_qty >= l.qty then 'returned'
       when l.due_date is not null and l.due_date < current_date then 'overdue'
       else 'active' end as status
from loans l;

-- ---------- 管理者判定 ----------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ============================================================
--  在庫整合の中核：原子的な貸出・返却（RPC）
--  ※ security definer。書込はこのRPC経由に限定する。
-- ============================================================

-- 貸出：在庫が足りる時だけ1行更新＝二重貸出を確実に防止
create or replace function lend_item(
  p_item_id uuid, p_qty integer, p_due_date date default null, p_note text default ''
) returns loans
language plpgsql security definer set search_path = public as $$
declare v_loan loans; v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '数量は1以上で指定してください' using errcode = '22023';
  end if;

  -- ★原子的減算：在庫が足りる時だけ更新される（行ロックで同時実行も安全）
  update items set stock = stock - p_qty
   where id = p_item_id and stock >= p_qty;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception '在庫が不足しています' using errcode = '23514';
  end if;

  insert into loans(item_id, user_id, qty, due_date, note)
  values (p_item_id, auth.uid(), p_qty, p_due_date, coalesce(p_note, ''))
  returning * into v_loan;
  return v_loan;
end $$;

-- 返却：一部返却対応。返却分だけ在庫を回復
create or replace function return_loan(p_loan_id uuid, p_qty integer)
returns loans
language plpgsql security definer set search_path = public as $$
declare v_loan loans; v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  -- 対象行をロックして読む
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then raise exception '貸出記録が見つかりません' using errcode = 'P0002'; end if;
  -- 一般ユーザは自分の貸出のみ返却可（管理者は誰でも可）
  if v_loan.user_id <> auth.uid() and not is_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;

  v_remaining := v_loan.qty - v_loan.returned_qty;
  if p_qty is null or p_qty <= 0 then raise exception '返却数量は1以上で指定してください' using errcode = '22023'; end if;
  if p_qty > v_remaining then raise exception '返却数量が未返却数(%)を超えています', v_remaining using errcode = '23514'; end if;

  update items set stock = stock + p_qty where id = v_loan.item_id;
  update loans
     set returned_qty = returned_qty + p_qty,
         returned_at  = case when returned_qty + p_qty >= qty then now() else returned_at end
   where id = p_loan_id
  returning * into v_loan;
  return v_loan;
end $$;

-- 総数変更（管理者）：貸出中を維持したまま在庫を再計算
create or replace function set_item_total(p_item_id uuid, p_total integer)
returns items language plpgsql security definer set search_path = public as $$
declare v items; v_out integer;
begin
  if not is_admin() then raise exception '権限がありません' using errcode = '42501'; end if;
  if p_total < 0 then raise exception '総数は0以上で指定してください' using errcode = '22023'; end if;
  select coalesce(sum(qty - returned_qty), 0) into v_out
    from loans where item_id = p_item_id and returned_qty < qty;
  if p_total < v_out then
    raise exception '総数(%)が貸出中(%)を下回ります', p_total, v_out using errcode = '23514';
  end if;
  update items set total_qty = p_total, stock = p_total - v_out
   where id = p_item_id returning * into v;
  return v;
end $$;

-- ---------- 新規ユーザ登録時に profiles を自動作成 ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ============================================================
--  Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table items    enable row level security;
alter table loans    enable row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (auth.uid() = id or is_admin());
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update using (auth.uid() = id);
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles for all using (is_admin()) with check (is_admin());

drop policy if exists items_select on items;
create policy items_select on items for select using (auth.uid() is not null);
drop policy if exists items_admin_write on items;
create policy items_admin_write on items for all using (is_admin()) with check (is_admin());

drop policy if exists loans_select on loans;
create policy loans_select on loans for select using (user_id = auth.uid() or is_admin());
drop policy if exists loans_admin_write on loans;
create policy loans_admin_write on loans for all using (is_admin()) with check (is_admin());

-- ---------- 権限付与（2026年以降の新規プロジェクトは明示的grantが必要） ----------
grant usage on schema public to anon, authenticated;
grant select on items, loans, profiles, loans_view to authenticated;
grant execute on function lend_item(uuid, integer, date, text) to authenticated;
grant execute on function return_loan(uuid, integer) to authenticated;
grant execute on function set_item_total(uuid, integer) to authenticated;
grant execute on function is_admin() to authenticated;

-- ============================================================
--  初期データ（任意）：実行すると物品が10件入ります
-- ============================================================
insert into items (item_code, name, category, total_qty, stock, location, unit) values
  ('TRQ-01','トルクレンチ','工具',3,3,'A-1','本'),
  ('IMP-02','インパクトレンチ','工具',2,2,'A-2','台'),
  ('JCK-03','油圧ジャッキ','設備',2,2,'B-1','台'),
  ('STD-04','ジャッキスタンド','設備',8,8,'B-1','脚'),
  ('HLM-05','ヘルメット','K4GP装備',6,6,'C-1','個'),
  ('GLV-06','レーシンググローブ','K4GP装備',6,6,'C-2','双'),
  ('FEX-07','消火器','安全',4,4,'D-1','本'),
  ('TIR-08','予備タイヤ','消耗品',8,8,'E-1','本'),
  ('OBD-09','故障診断機 (OBD)','計測器',1,1,'A-3','台'),
  ('TPM-10','タイヤ空気圧計','計測器',3,3,'A-3','個')
on conflict (item_code) do nothing;

-- ============================================================
--  運用メモ
--  ・最初に作った自分のアカウントを管理者にする：
--      update profiles set role = 'admin' where id = (select id from auth.users where email = 'あなたのメール');
-- ============================================================
