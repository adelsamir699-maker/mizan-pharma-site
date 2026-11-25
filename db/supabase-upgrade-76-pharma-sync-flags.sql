-- ============================================================================
-- ترحيل ٧٦ — «ميزان فارما»: أعمدة تزامن ناقصة للدفعات والصرف
-- ----------------------------------------------------------------------------
-- الطبقة المحلية كانت بتخزّن flagين مهمين مفيش لهم عمود في ترقية ٧٣:
--   • stock_added     : هل استلام الدفعة زاد رصيد الصنف؟ (بيتحقق منه عند الحذف)
--   • needs_reconcile : هل تخصيص الدفعات ما كملش وقت الصرف؟
-- من غيرهم التزامن بين الأجهزة يفقد المعنى ويحصل خصم رصيد غلط.
-- الترحيل إضافة بس (idempotent)، وما يلمسش الدخول/الباسورد/الاشتراكات/الدعوات.
-- ============================================================================

alter table public.pharma_batches
  add column if not exists stock_added boolean not null default false;

alter table public.pharma_dispenses
  add column if not exists needs_reconcile boolean not null default false;

comment on column public.pharma_batches.stock_added is
  'true لو استلام الدفعة زاد رصيد products؛ الحذف يخصم الرصيد في هذه الحالة فقط';
comment on column public.pharma_dispenses.needs_reconcile is
  'true لو الكمية المتاحة من الدفعات أقل من المصروف وتمت تسوية الرصيد';

notify pgrst, 'reload schema';
