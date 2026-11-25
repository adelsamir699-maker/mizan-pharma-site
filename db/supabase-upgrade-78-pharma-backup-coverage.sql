-- ترقية ٧٨ — تغطية جداول ميزان فارما في النسخ الاحتياطي والاستعادة والتفريغ
-- التاريخ: 25/11/2026 · بناء 7
-- الغرض: الجداول الثلاثة (pharma_product_meta / pharma_batches / pharma_dispenses)
--        كانت خارج دوال النسخ والاستعادة والتفريغ. الترقية تلفّ الدوال الحالية
--        (بلا إعادة كتابة منطقها) وتضيف الجداول الثلاثة فقط.
-- آمنة للتكرار (idempotent) — بلا begin/commit (نمط الترقيات ٢٤/٢٨/٢٩/٦٦).
-- صفر تعديل على أي صف موجود؛ كل الحذف مقصور على شركة مُحددة في مسار الاستعادة/التفريغ.

-- ---------------------------------------------------------------------------
-- 0) إعادة تسمية الدوال الأصلية مرة واحدة، مع حفظ تواقيعها كما هي
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='mizan_admin_backup_full_pre78' and p.prokind='f') then
    alter function public.mizan_admin_backup_full() rename to mizan_admin_backup_full_pre78;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='mizan_admin_restore_full_pre78' and p.prokind='f') then
    alter function public.mizan_admin_restore_full(jsonb) rename to mizan_admin_restore_full_pre78;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='mizan_admin_export_all_pre78' and p.prokind='f') then
    alter function public.mizan_admin_export_all() rename to mizan_admin_export_all_pre78;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='mizan_admin_export_one_pre78' and p.prokind='f') then
    alter function public.mizan_admin_export_one(uuid) rename to mizan_admin_export_one_pre78;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='mizan_admin_restore_one_pre78' and p.prokind='f') then
    alter function public.mizan_admin_restore_one(uuid, jsonb) rename to mizan_admin_restore_one_pre78;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='mizan_admin_reset_org_pre78' and p.prokind='f') then
    alter function public.mizan_admin_reset_org(uuid, text) rename to mizan_admin_reset_org_pre78;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 1) النسخة الشاملة: الأصل + الجداول الثلاثة (كل الشركات)
-- ---------------------------------------------------------------------------
create or replace function public.mizan_admin_backup_full()
  returns jsonb language plpgsql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb;
  t text;
  rows jsonb;
begin
  v_out := public.mizan_admin_backup_full_pre78();
  foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    v_out := jsonb_set(v_out, array[t], rows);
  end loop;
  return v_out;
end $function$;

-- ---------------------------------------------------------------------------
-- 2) الاستعادة الشاملة: الأصل ثم زرع الجداول الثلاثة لشركات الملف
-- ---------------------------------------------------------------------------
create or replace function public.mizan_admin_restore_full(p_payload jsonb)
  returns text language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_res text;
  t text;
  r jsonb;
  v_org jsonb;
begin
  v_res := public.mizan_admin_restore_full_pre78(p_payload);

  for v_org in select jsonb_array_elements(coalesce(p_payload->'organizations', '[]'::jsonb)) loop
    if v_org->>'id' is not null then
      foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
        execute format('delete from public.%I where org_id=$1', t) using (v_org->>'id')::uuid;
      end loop;
    end if;
  end loop;

  foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
    if p_payload ? t and jsonb_typeof(p_payload->t) = 'array' then
      for r in select jsonb_array_elements(p_payload->t) loop
        execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1::jsonb)', t, t) using r;
      end loop;
    end if;
  end loop;
  return v_res;
end $function$;

-- ---------------------------------------------------------------------------
-- 3) تصدير شركة واحدة (المسار القديم): الأصل + الجداول الثلاثة مقصورة على الشركة
-- ---------------------------------------------------------------------------
create or replace function public.mizan_admin_export_all()
  returns jsonb language plpgsql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb;
  t text;
  rows jsonb;
begin
  v_out := public.mizan_admin_export_all_pre78();
  foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    v_out := jsonb_set(v_out, array[t], rows);
  end loop;
  return v_out;
end $function$;

create or replace function public.mizan_admin_export_one(p_org_id uuid)
  returns jsonb language plpgsql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb;
  t text;
  rows jsonb;
begin
  v_out := public.mizan_admin_export_one_pre78(p_org_id);
  foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.org_id=$1', t) into rows using p_org_id;
    v_out := jsonb_set(v_out, array[t], rows);
  end loop;
  return v_out;
end $function$;

-- ---------------------------------------------------------------------------
-- 4) استعادة شركة واحدة (ومنها الاستعادة الشاملة القديمة): الأصل + الجداول الثلاثة
-- ---------------------------------------------------------------------------
create or replace function public.mizan_admin_restore_one(p_org_id uuid, p_payload jsonb)
  returns void language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  t text;
  r jsonb;
begin
  perform public.mizan_admin_restore_one_pre78(p_org_id, p_payload);

  foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
    execute format('delete from public.%I where org_id=$1', t) using p_org_id;
    if p_payload ? t and jsonb_typeof(p_payload->t) = 'array' then
      for r in select jsonb_array_elements(p_payload->t) loop
        if r->>'org_id' is null then
          r := jsonb_set(r, '{org_id}', to_jsonb(p_org_id));
        end if;
        if (r->>'org_id')::uuid = p_org_id then
          execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1::jsonb)', t, t) using r;
        end if;
      end loop;
    end if;
  end loop;
end $function$;

-- ---------------------------------------------------------------------------
-- 5) تفريغ شركة: الأصل (بوابة كلمة السر 먼ها) ثم حذف الجداول الثلاثة لتلك الشركة
-- ---------------------------------------------------------------------------
create or replace function public.mizan_admin_reset_org(p_org_id uuid, p_password text)
  returns void language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  t text;
begin
  perform public.mizan_admin_reset_org_pre78(p_org_id, p_password);
  foreach t in array array['pharma_product_meta','pharma_batches','pharma_dispenses'] loop
    execute format('delete from public.%I where org_id=$1', t) using p_org_id;
  end loop;
end $function$;

-- ---------------------------------------------------------------------------
-- 6) الصلاحيات: نفس سياسة ٤٣/٦٦ — authenticated + service_role، وممنوع anon/public
-- ---------------------------------------------------------------------------
revoke all on function public.mizan_admin_backup_full()                 from public, anon;
revoke all on function public.mizan_admin_restore_full(jsonb)           from public, anon;
revoke all on function public.mizan_admin_export_all()                  from public, anon;
revoke all on function public.mizan_admin_export_one(uuid)              from public, anon;
revoke all on function public.mizan_admin_restore_one(uuid, jsonb)      from public, anon;
revoke all on function public.mizan_admin_reset_org(uuid, text)         from public, anon;

grant execute on function public.mizan_admin_backup_full()             to authenticated, service_role;
grant execute on function public.mizan_admin_restore_full(jsonb)       to authenticated, service_role;
grant execute on function public.mizan_admin_export_all()              to authenticated, service_role;
grant execute on function public.mizan_admin_export_one(uuid)          to authenticated, service_role;
grant execute on function public.mizan_admin_restore_one(uuid, jsonb)  to authenticated, service_role;
grant execute on function public.mizan_admin_reset_org(uuid, text)     to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) فحص بعدي: الدوال الستة موجودة، والجداول الثلاثة موجودة ومحمية بـ RLS
-- ---------------------------------------------------------------------------
do $do$
declare
  v_fn int;
  v_tbl int;
  v_rls int;
begin
  select count(*) into v_fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f' and p.proname in
     ('mizan_admin_backup_full','mizan_admin_restore_full','mizan_admin_export_all',
      'mizan_admin_export_one','mizan_admin_restore_one','mizan_admin_reset_org',
      'mizan_admin_backup_full_pre78','mizan_admin_restore_full_pre78','mizan_admin_export_all_pre78',
      'mizan_admin_export_one_pre78','mizan_admin_restore_one_pre78','mizan_admin_reset_org_pre78');
  if v_fn <> 12 then
    raise exception 'فحص ٧٨ بعدي: عدد الدوال (%) مش ١٢', v_fn;
  end if;

  select count(*) into v_tbl from information_schema.tables
   where table_schema='public' and table_name in
     ('pharma_product_meta','pharma_batches','pharma_dispenses');
  if v_tbl <> 3 then
    raise exception 'فحص ٧٨ بعدي: الجداول الصيدلية ناقصة (%)', v_tbl;
  end if;

  select count(*) into v_rls from pg_tables
   where schemaname='public' and tablename in
     ('pharma_product_meta','pharma_batches','pharma_dispenses') and rowsecurity is true;
  if v_rls <> 3 then
    raise exception 'فحص ٧٨ بعدي: RLS مش مفعّل على كل الجداول (%)', v_rls;
  end if;
end
$do$;
