-- ترقية ٨١ — ميزان فارما: عدد الشرائط بالعلبة ( Building 14 )
-- التاريخ: 25/11/2026 · بناء 14
-- تُطبَّق على المشروع المستقل الجديد فقط (pnfndyqnvaqatcongzqb).
-- صفر لمس للمشروع الأصلي osjbbccckonfzhtjwsre.
--
-- تُخزِّن القيمة في pharma_product_meta (مش في products) عشان تفضل داخل طبقة الصيدلية
-- وتدخل تلقائيًا في النسخ/الاستعادة (ترقية ٧٨ بتقرأ to_jsonb/jsonb_populate_record).
-- القيد يمنع الأرقام السالبة أو القيم غير المعقولة اللي تعمل قائمة منسدلة ضخمة.
-- idempotent: آمنة إعادة التشغيل.

alter table public.pharma_product_meta
  add column if not exists strips_per_box integer not null default 0;

comment on column public.pharma_product_meta.strips_per_box is
  'عدد الشرائط الكلي في العلبة؛ 0 أو 1 = لا يوجد سعر شريط (سعر العلبة كما هو).';

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pharma_product_meta_strips_per_box_range'
      and conrelid = 'public.pharma_product_meta'::regclass
  ) then
    alter table public.pharma_product_meta
      add constraint pharma_product_meta_strips_per_box_range
      check (strips_per_box >= 0 and strips_per_box <= 500);
  end if;
end
$do$;
