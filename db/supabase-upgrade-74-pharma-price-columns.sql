-- ============================================================================
-- ترحيل ٧٤ — «ميزان فارما»: استكمال أعمدة أسعار الشراء على products
-- ----------------------------------------------------------------------------
-- نفس منطق ميزان الأصلي: `cloud.js` يفحص وجود العمودين `last_purchase_price`
-- و`avg_purchase_price` قبل رفع الأصناف (بناء ١٧٩). على قاعدة جديدة ما كانش
-- العمودين موجودين، فكان الفحص بيرجّع 400 والخانتين ما كانوش بيترفعوا.
-- الترحيل إضافة بس (idempotent): ما يلمسش أي بيانات، ولا منطق باسورد/اشتراكات/دعوات.
-- ============================================================================

alter table public.products
  add column if not exists last_purchase_price numeric not null default 0,
  add column if not exists avg_purchase_price   numeric not null default 0;

comment on column public.products.last_purchase_price is 'آخر سعر شراء — مستخدم في استيراد الإكسيل ومزامنة الأصناف';
comment on column public.products.avg_purchase_price   is 'متوسط سعر الشراء — مستخدم في استيراد الإكسيل ومزامنة الأصناف';
