-- ============================================================================
-- ترحيل ٧٣ — «ميزان فارما»: جداول الدفعات والصرف والمعلومات الصيدلانية
-- ----------------------------------------------------------------------------
-- مخصّص لمشروع Supabase **جديد مستقل** عن ميزان الأصلي.
-- ✅ اتنفّذ على المشروع المستقل 25/11 ودخل حزمة النشر (طلع من DEPLOY_DB_EXCLUDE).
--
-- نفس نمط ميزان في العزل: id uuid + org_id (عزل الشركة عبر current_org())
-- + local_id (الرقم المحلي الثابت من جهاز الصيدلية) + فهرس فريد (org_id, local_id).
-- لا لمس لأي جدول موجود، ولا لمس لمنطق الباسورد/الاشتراكات/الدعوات.
--
-- الجداول:
--   pharma_product_meta  : معلومات الدواء (مادة فعالة/تركيز/شكل/تسجيل/تخزين/وصفة)
--   pharma_batches       : دفعات الاستلام (رقم دفعة/انتهاء/كمية/سعر/مستودع)
--   pharma_dispenses     : سجل الصرف بعد حفظ فاتورة البيع (مرتبط برقم الفاتورة)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) معلومات الدواء — سطر واحد لكل صنف محلي في كل شركة
-- ---------------------------------------------------------------------------
create table if not exists public.pharma_product_meta (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  local_id bigint not null,
  product_code text default '',
  active_ingredient text default '',
  manufacturer text default '',
  registration_no text default '',
  form text default '',
  strength text default '',
  storage text default '',
  rx_required boolean not null default false,
  notes text default '',
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_pharma_product_meta_org on public.pharma_product_meta (org_id);
create unique index if not exists uq_pharma_product_meta_orglocal
  on public.pharma_product_meta (org_id, local_id);

-- ---------------------------------------------------------------------------
-- 2) الدفعات
-- ---------------------------------------------------------------------------
create table if not exists public.pharma_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  local_id text not null,                 -- معرّف ثابت من جهاز الصيدلية
  product_local_id bigint not null,       -- رقم الصنف في دليل أصناف ميزان
  product_code text default '',
  batch_no text not null,
  expiry_date date,
  qty numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  warehouse text default '',
  status text not null default 'active'
    constraint pharma_batches_status_ok check (status in ('active','blocked')),
  deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_pharma_batches_org on public.pharma_batches (org_id);
create index if not exists idx_pharma_batches_product on public.pharma_batches (org_id, product_local_id);
create index if not exists idx_pharma_batches_expiry on public.pharma_batches (org_id, expiry_date);
create unique index if not exists uq_pharma_batches_orglocal
  on public.pharma_batches (org_id, local_id);

-- ---------------------------------------------------------------------------
-- 3) سجل الصرف
-- ---------------------------------------------------------------------------
create table if not exists public.pharma_dispenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  local_id text not null,
  sale_local_id bigint,                   -- رقم فاتورة البيع في ميزان
  invoice_no text default '',
  doc_date date,
  product_local_id bigint not null,
  product_code text default '',
  product_name text default '',
  qty numeric(14,2) not null default 0,
  batch_info text default '',             -- ملخّص الدفعات المستهلكة (FEFO)
  expiry_date date,
  patient_name text default '',
  doctor_name text default '',
  rx_no text default '',
  notes text default '',
  deleted boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_pharma_dispenses_org on public.pharma_dispenses (org_id);
create index if not exists idx_pharma_dispenses_date on public.pharma_dispenses (org_id, doc_date);
create index if not exists idx_pharma_dispenses_sale on public.pharma_dispenses (org_id, sale_local_id);
create unique index if not exists uq_pharma_dispenses_orglocal
  on public.pharma_dispenses (org_id, local_id);

-- ---------------------------------------------------------------------------
-- 4) RLS: عزل تام زي بقية جداول ميزان — لا منح لـ anon إطلاقًا
-- ---------------------------------------------------------------------------
alter table public.pharma_product_meta enable row level security;
alter table public.pharma_batches enable row level security;
alter table public.pharma_dispenses enable row level security;

drop policy if exists pharma_product_meta_select on public.pharma_product_meta;
drop policy if exists pharma_product_meta_insert on public.pharma_product_meta;
drop policy if exists pharma_product_meta_update on public.pharma_product_meta;
drop policy if exists pharma_product_meta_delete on public.pharma_product_meta;
create policy pharma_product_meta_select on public.pharma_product_meta for select using (org_id = public.current_org());
create policy pharma_product_meta_insert on public.pharma_product_meta for insert with check (org_id = public.current_org());
create policy pharma_product_meta_update on public.pharma_product_meta for update using (org_id = public.current_org());
create policy pharma_product_meta_delete on public.pharma_product_meta for delete using (org_id = public.current_org());

drop policy if exists pharma_batches_select on public.pharma_batches;
drop policy if exists pharma_batches_insert on public.pharma_batches;
drop policy if exists pharma_batches_update on public.pharma_batches;
drop policy if exists pharma_batches_delete on public.pharma_batches;
create policy pharma_batches_select on public.pharma_batches for select using (org_id = public.current_org());
create policy pharma_batches_insert on public.pharma_batches for insert with check (org_id = public.current_org());
create policy pharma_batches_update on public.pharma_batches for update using (org_id = public.current_org());
create policy pharma_batches_delete on public.pharma_batches for delete using (org_id = public.current_org());

drop policy if exists pharma_dispenses_select on public.pharma_dispenses;
drop policy if exists pharma_dispenses_insert on public.pharma_dispenses;
drop policy if exists pharma_dispenses_update on public.pharma_dispenses;
drop policy if exists pharma_dispenses_delete on public.pharma_dispenses;
create policy pharma_dispenses_select on public.pharma_dispenses for select using (org_id = public.current_org());
create policy pharma_dispenses_insert on public.pharma_dispenses for insert with check (org_id = public.current_org());
create policy pharma_dispenses_update on public.pharma_dispenses for update using (org_id = public.current_org());
create policy pharma_dispenses_delete on public.pharma_dispenses for delete using (org_id = public.current_org());

revoke all on public.pharma_product_meta from anon;
revoke all on public.pharma_batches from anon;
revoke all on public.pharma_dispenses from anon;
revoke all on public.pharma_product_meta from public;
revoke all on public.pharma_batches from public;
revoke all on public.pharma_dispenses from public;
grant select, insert, update, delete on public.pharma_product_meta to authenticated;
grant select, insert, update, delete on public.pharma_batches to authenticated;
grant select, insert, update, delete on public.pharma_dispenses to authenticated;

comment on table public.pharma_product_meta is 'ميزان فارما — معلومات دوائية إضافية لكل صنف (لا تلمس جدول products)';
comment on table public.pharma_batches is 'ميزان فارما — دفعات الاستلام والصلاحية';
comment on table public.pharma_dispenses is 'ميزان فارما — سجل صرف الأدوية المرتبط بفواتير البيع';

-- ---------------------------------------------------------------------------
-- 5) فحص ذاتي
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.tables where table_schema='public'
        and table_name in ('pharma_product_meta','pharma_batches','pharma_dispenses')) <> 3 then
    raise exception 'ترحيل ٧٣ فشل: جداول الصيدلية غير مكتملة';
  end if;
  if (select count(*) from pg_policies where schemaname='public'
        and tablename like 'pharma_%') <> 12 then
    raise exception 'ترحيل ٧٣ فشل: سياسات RLS غير مكتملة (المطلوب 12)';
  end if;
end $$;

notify pgrst, 'reload schema';
