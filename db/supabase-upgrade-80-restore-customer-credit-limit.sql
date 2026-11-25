-- ترقية ٨٠ — إصلاح مسار الاستعادة ( Building 9 )
-- التاريخ: 25/11/2026 · بناء 9
-- ١) mizan_admin_restore_one_pre78 كان يكتب عمود current_balance في جدول customers
--    (العمود موجود في suppliers بس) → «column current_balance of relation customers does not exist».
--    الترقية تكتب credit_limit، وتقبل المفتاح القديم current_balance كبديل للنسخ القديمة.
-- ٢) الدالة كانت تحذف الجداول قبل إعادة الإدراج إلا suppliers و products → أي استعادة
--    فوق شركة فيها بيانات كانت تفشل بـ duplicate key على suppliers_pkey / products_pkey.
--    الترقية تضيف حذف الاثنين قبل الإدراج (مفيش أي Foreign Key يشير لهما — تم الفحص).
-- ٣) انحراف المخطط: products كانت تستخدم price/cost/qty (دلوقتي sale_price/purchase_price/stock_qty)،
--    و categories و units كانوا يكتبوا is_active (عمود غير موجود). الترقية تعيد الإدراج
--    بالأعمدة الحالية وتحتفظ بكل الحقول الإضافية (stock/barcode/name_en/أسعار الشراء...).
-- باقي الدالة والجداول زي ما هي حرفيًا — صفر تغيير في البيانات المخزّنة.

CREATE OR REPLACE FUNCTION public.mizan_admin_restore_one_pre78(p_org_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r jsonb;
  v_id uuid;
  v_org jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_superadmin is true) then
    raise exception 'غير مصرح';
  end if;

  -- تحديد كائن الشركة: من قائمة الشركات (شامل) أو من مفتاح org (نسخة شركة واحدة)
  if p_payload->'organizations' is not null then
    select e into v_org from jsonb_array_elements(p_payload->'organizations') e
    where e->>'id' = p_org_id::text limit 1;
  else
    v_org := p_payload->'org';
  end if;

  -- تحديث / إدراج الشركة نفسها
  if v_org is not null then
    if exists (select 1 from public.organizations where id = p_org_id) then
      if (v_org->>'name') is not null then update public.organizations set name = v_org->>'name' where id = p_org_id; end if;
      if (v_org->>'phone') is not null then update public.organizations set phone = v_org->>'phone' where id = p_org_id; end if;
      if (v_org->>'address') is not null then update public.organizations set address = v_org->>'address' where id = p_org_id; end if;
      if (v_org->>'tax_number') is not null then update public.organizations set tax_number = v_org->>'tax_number' where id = p_org_id; end if;
      if (v_org->>'tax_enabled') is not null then update public.organizations set tax_enabled = (v_org->>'tax_enabled')::boolean where id = p_org_id; end if;
      if (v_org->>'tax_rate') is not null then update public.organizations set tax_rate = (v_org->>'tax_rate')::numeric where id = p_org_id; end if;
      if (v_org->>'tax_buy_enabled') is not null then update public.organizations set tax_buy_enabled = (v_org->>'tax_buy_enabled')::boolean where id = p_org_id; end if;
      if (v_org->>'tax_rate_buy') is not null then update public.organizations set tax_rate_buy = (v_org->>'tax_rate_buy')::numeric where id = p_org_id; end if;
      if (v_org->>'tax_title') is not null then update public.organizations set tax_title = v_org->>'tax_title' where id = p_org_id; end if;
      if (v_org->>'paper_size') is not null then update public.organizations set paper_size = v_org->>'paper_size' where id = p_org_id; end if;
      if (v_org->>'warranty_terms') is not null then update public.organizations set warranty_terms = v_org->>'warranty_terms' where id = p_org_id; end if;
      if (v_org->>'org_note') is not null then update public.organizations set org_note = v_org->>'org_note' where id = p_org_id; end if;
    else
      insert into public.organizations (id, name, phone, address, tax_number, tax_enabled, tax_rate, tax_buy_enabled, tax_rate_buy, tax_title, paper_size, warranty_terms, org_note)
      values (p_org_id, v_org->>'name', v_org->>'phone', v_org->>'address', v_org->>'tax_number',
              coalesce((v_org->>'tax_enabled')::boolean, false), coalesce((v_org->>'tax_rate')::numeric, 0),
              coalesce((v_org->>'tax_buy_enabled')::boolean, false), coalesce((v_org->>'tax_rate_buy')::numeric, 0),
              v_org->>'tax_title', v_org->>'paper_size', v_org->>'warranty_terms', v_org->>'org_note');
    end if;
  end if;

  delete from public.sale_items where org_id = p_org_id;
  delete from public.sales where org_id = p_org_id;
  delete from public.purchase_items where org_id = p_org_id;
  delete from public.purchases where org_id = p_org_id;
  delete from public.supplier_txs where org_id = p_org_id;
  delete from public.customer_txs where org_id = p_org_id;
  delete from public.vouchers where org_id = p_org_id;
  delete from public.journal_lines where org_id = p_org_id;
  delete from public.journal_entries where org_id = p_org_id;
  delete from public.treasury where org_id = p_org_id;
  delete from public.accounts where org_id = p_org_id;
  delete from public.owners where org_id = p_org_id;
  delete from public.warehouses where org_id = p_org_id;
  delete from public.units where org_id = p_org_id;
  delete from public.categories where org_id = p_org_id;
  delete from public.customers where org_id = p_org_id;
  delete from public.suppliers where org_id = p_org_id;
  delete from public.products where org_id = p_org_id;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'customers', p_org_id::text))
  loop
    insert into public.customers (id, org_id, local_id, code, name_ar, phone, address, opening_balance, credit_limit, is_active, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'code', r->>'name_ar', r->>'phone', r->>'address',
            coalesce((r->>'opening_balance')::numeric, 0), coalesce((r->>'credit_limit')::numeric, coalesce((r->>'current_balance')::numeric, 0)),
            coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'suppliers', p_org_id::text))
  loop
    insert into public.suppliers (id, org_id, local_id, code, name_ar, phone, address, opening_balance, current_balance, is_active, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'code', r->>'name_ar', r->>'phone', r->>'address',
            coalesce((r->>'opening_balance')::numeric, 0), coalesce((r->>'current_balance')::numeric, 0),
            coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'products', p_org_id::text))
  loop
    insert into public.products (id, org_id, local_id, code, name_ar, name_en, barcode, category, unit,
      sale_price, purchase_price, stock_qty, min_stock, stock, last_purchase_price, avg_purchase_price,
      is_active, deleted, created_at, updated_at, device_id, rev, deleted_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint,
      r->>'code', r->>'name_ar', r->>'name_en', r->>'barcode', r->>'category', r->>'unit',
      coalesce((r->>'sale_price')::numeric, (r->>'price')::numeric, 0),
      coalesce((r->>'purchase_price')::numeric, (r->>'cost')::numeric, 0),
      coalesce((r->>'stock_qty')::numeric, (r->>'qty')::numeric, 0),
      coalesce((r->>'min_stock')::numeric, 0), coalesce((r->'stock'), '{}'::jsonb),
      coalesce((r->>'last_purchase_price')::numeric, 0), coalesce((r->>'avg_purchase_price')::numeric, 0),
      coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false),
      coalesce((r->>'created_at')::timestamptz, now()), coalesce((r->>'updated_at')::timestamptz, now()),
      r->>'device_id', coalesce((r->>'rev')::bigint, 0), (r->>'deleted_at')::timestamptz);
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'treasury', p_org_id::text))
  loop
    insert into public.treasury (id, org_id, local_id, name, type, account_no, opening_balance, balance, is_active, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'name', coalesce(r->>'type','cash'), r->>'account_no',
            coalesce((r->>'opening_balance')::numeric, 0), coalesce((r->>'balance')::numeric, 0),
            coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'accounts', p_org_id::text))
  loop
    insert into public.accounts (id, org_id, local_id, code, name_ar, type, parent_id, opening_debit, opening_credit, is_active, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'code', r->>'name_ar', r->>'type',
            (r->>'parent_id')::bigint, coalesce((r->>'opening_debit')::numeric, 0), coalesce((r->>'opening_credit')::numeric, 0),
            coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'categories', p_org_id::text))
  loop
    insert into public.categories (id, org_id, name, description, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, r->>'name', r->>'description', coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'units', p_org_id::text))
  loop
    insert into public.units (id, org_id, name, symbol, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, r->>'name', r->>'symbol', coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'warehouses', p_org_id::text))
  loop
    insert into public.warehouses (id, org_id, code, name, address, is_active, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, r->>'code', r->>'name', r->>'address', coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'owners', p_org_id::text))
  loop
    insert into public.owners (id, org_id, name, phone, capital, withdrawals, is_active, deleted, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, r->>'name', r->>'phone', coalesce((r->>'capital')::numeric, 0), coalesce((r->>'withdrawals')::numeric, 0), coalesce((r->>'is_active')::boolean, true), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'sales', p_org_id::text))
  loop
    insert into public.sales (id, org_id, local_id, invoice_no, doc_date, customer, payment_method, treasury_id, store, notes, discount, tax, grand_total, paid_amount, due_amount, payments, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'invoice_no', coalesce((r->>'doc_date')::date, now()::date), r->>'customer', r->>'payment_method',
            (r->>'treasury_id')::text, r->>'store', r->>'notes', coalesce((r->>'discount')::numeric, 0), coalesce((r->>'tax')::numeric, 0), coalesce((r->>'grand_total')::numeric, 0),
            coalesce(nullif(r->>'paid_amount','')::numeric, case when btrim(coalesce(r->>'payment_method','')) = 'آجل' then 0 else coalesce((r->>'grand_total')::numeric, 0) end),
            coalesce(nullif(r->>'due_amount','')::numeric,  case when btrim(coalesce(r->>'payment_method','')) = 'آجل' then coalesce((r->>'grand_total')::numeric, 0) else 0 end),
            coalesce(case when jsonb_typeof(r->'payments') = 'array' then r->'payments' else '[]'::jsonb end, '[]'::jsonb),
            coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'sale_items', p_org_id::text))
  loop
    insert into public.sale_items (id, org_id, local_id, sale_id, product_id, product_name, qty, price, total)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, coalesce((r->>'sale_id')::uuid, gen_random_uuid()), (r->>'product_id')::text, r->>'product_name',
            coalesce((r->>'qty')::numeric, 0), coalesce((r->>'price')::numeric, 0), coalesce((r->>'total')::numeric, 0));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'purchases', p_org_id::text))
  loop
    insert into public.purchases (id, org_id, local_id, invoice_no, doc_date, supplier, payment_method, treasury_id, store, notes, discount, tax, grand_total, paid_amount, due_amount, payments, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'invoice_no', coalesce((r->>'doc_date')::date, now()::date), r->>'supplier', r->>'payment_method',
            (r->>'treasury_id')::text, r->>'store', r->>'notes', coalesce((r->>'discount')::numeric, 0), coalesce((r->>'tax')::numeric, 0), coalesce((r->>'grand_total')::numeric, 0),
            coalesce(nullif(r->>'paid_amount','')::numeric, case when btrim(coalesce(r->>'payment_method','')) = 'آجل' then 0 else coalesce((r->>'grand_total')::numeric, 0) end),
            coalesce(nullif(r->>'due_amount','')::numeric,  case when btrim(coalesce(r->>'payment_method','')) = 'آجل' then coalesce((r->>'grand_total')::numeric, 0) else 0 end),
            coalesce(case when jsonb_typeof(r->'payments') = 'array' then r->'payments' else '[]'::jsonb end, '[]'::jsonb),
            coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'purchase_items', p_org_id::text))
  loop
    insert into public.purchase_items (id, org_id, local_id, purchase_id, product_id, product_name, qty, price, total)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, coalesce((r->>'purchase_id')::uuid, gen_random_uuid()), (r->>'product_id')::text, r->>'product_name',
            coalesce((r->>'qty')::numeric, 0), coalesce((r->>'price')::numeric, 0), coalesce((r->>'total')::numeric, 0));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'supplier_txs', p_org_id::text))
  loop
    insert into public.supplier_txs (id, org_id, local_id, supplier_id, doc_date, type, amount, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, (r->>'supplier_id')::text, coalesce((r->>'doc_date')::date, now()::date), r->>'type', coalesce((r->>'amount')::numeric, 0), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'customer_txs', p_org_id::text))
  loop
    insert into public.customer_txs (id, org_id, local_id, customer_id, doc_date, description, debit, credit, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, (r->>'customer_id')::text, coalesce((r->>'doc_date')::date, now()::date), r->>'description', coalesce((r->>'debit')::numeric, 0), coalesce((r->>'credit')::numeric, 0), coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'vouchers', p_org_id::text))
  loop
    insert into public.vouchers (id, org_id, local_id, no, doc_date, kind, treasury_id, account_id, amount, notes, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'no', coalesce((r->>'doc_date')::date, now()::date), r->>'kind', (r->>'treasury_id')::text, (r->>'account_id')::text, coalesce((r->>'amount')::numeric, 0), r->>'notes', coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'journal_entries', p_org_id::text))
  loop
    insert into public.journal_entries (id, org_id, local_id, jrn_no, doc_date, ref_type, ref_id, description, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, r->>'jrn_no', coalesce((r->>'doc_date')::date, now()::date), r->>'ref_type', (r->>'ref_id')::text, r->>'description', coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'journal_lines', p_org_id::text))
  loop
    insert into public.journal_lines (id, org_id, local_id, entry_id, account_id, account_name, debit, credit)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), p_org_id, (r->>'local_id')::bigint, coalesce((r->>'entry_id')::uuid, gen_random_uuid()), (r->>'account_id')::text, r->>'account_name', coalesce((r->>'debit')::numeric, 0), coalesce((r->>'credit')::numeric, 0));
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'checks', p_org_id::text))
  loop
    insert into public.checks select * from jsonb_populate_record(null::public.checks, jsonb_set(r,'{org_id}',to_jsonb(p_org_id))) on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'cashier_shifts', p_org_id::text))
  loop
    insert into public.cashier_shifts select * from jsonb_populate_record(null::public.cashier_shifts, jsonb_set(r,'{org_id}',to_jsonb(p_org_id))) on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(public.mizan_org_rows(p_payload,'car_trips', p_org_id::text))
  loop
    insert into public.car_trips select * from jsonb_populate_record(null::public.car_trips, jsonb_set(r,'{org_id}',to_jsonb(p_org_id))) on conflict do nothing;
  end loop;
end $function$;
-- فحص بعدي: تعريف الدالة ما بisses أي إشارة لـ current_balance في سياق customers،
-- وعمود credit_limit موجود فعلاً في الجدول.
do $do$
declare
  v_def text;
  v_col int;
begin
  select pg_get_functiondef('public.mizan_admin_restore_one_pre78(uuid,jsonb)'::regprocedure) into v_def;
  if v_def like '%insert into public.customers (id, org_id, local_id, code, name_ar, phone, address, opening_balance, current_balance%' then
    raise exception 'فحص ٨٠ بعدي: customers لسه بيكتب current_balance';
  end if;
  if v_def not like '%insert into public.customers (id, org_id, local_id, code, name_ar, phone, address, opening_balance, credit_limit%' then
    raise exception 'فحص ٨٠ بعدي: customers مش بيكتب credit_limit';
  end if;
  if v_def not like '%delete from public.suppliers where org_id = p_org_id%' then
    raise exception 'فحص ٨٠ بعدي: suppliers مش اتساحوا قبل الاستعادة';
  end if;
  if v_def not like '%delete from public.products where org_id = p_org_id%' then
    raise exception 'فحص ٨٠ بعدي: products مش اتساحوا قبل الاستعادة';
  end if;
  if v_def like '%insert into public.products (id, org_id, local_id, code, name_ar, price%' then
    raise exception 'فحص ٨٠ بعدي: products لسه بيستخدم price/cost/qty';
  end if;
  if v_def like '%insert into public.categories (id, org_id, name, is_active%' then
    raise exception 'فحص ٨٠ بعدي: categories لسه بيكتب is_active';
  end if;
  if v_def like '%insert into public.units (id, org_id, name, symbol, is_active%' then
    raise exception 'فحص ٨٠ بعدي: units لسه بيكتب is_active';
  end if;
  select count(*) into v_col from information_schema.columns
   where table_schema='public' and table_name='customers' and column_name='credit_limit';
  if v_col <> 1 then
    raise exception 'فحص ٨٠ بعدي: عمود credit_limit مفقود';
  end if;
end
$do$;
