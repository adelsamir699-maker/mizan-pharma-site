-- ============================================================================
-- ترقية ٤٩ — سحب EXECUTE من «الزائر» و«أي حد» على دوال ميزان
-- (ميزان فارما: نفس هدف الترقية الأصلية، مع بوابات مقاسة من القاعدة الجديدة
--  بدل الأرقام المكتوبة من قياس السحابة القديمة 03/10 — لأن نسخة النشر
--  بتشمل ٦٨ حذف الدردشة فعدد الدوال/السياسات مختلف على سيرفر جديد.)
-- ============================================================================

-- النطاق اللي اتنفّذ على السحابة الأصلية: (ج) full = الدوال الـ22 + تنظيف جداول anon.
set mizan_49.scope = 'full';
set mizan_49.anon_tables = 'on';

-- ═══ ١) لقطة «قبل» جوه نفس المعاملة ═══
create temp table mizan_49_live_before on commit drop as
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public') as fns,
  (select count(*) from pg_policies where schemaname = 'public') as pols,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relrowsecurity) as rls_tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, 'SELECT')) as auth_tables,
  (select md5(string_agg(p.proname || '=' || md5(p.prosrc), E'\n'
           order by p.proname || '=' || md5(p.prosrc)))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public') as fingerprint;

-- ═══ ٢) بوابة «قبل» ═══
do $$
declare
  v_scope text := coalesce(nullif(current_setting('mizan_49.scope', true), ''), '');
  v_tables text := coalesce(nullif(current_setting('mizan_49.anon_tables', true), ''), 'off');
  v_names text[] := array[
    'create_org_and_profile','current_org','join_org','mizan_access','mizan_add_doc',
    'mizan_admin_delete_org','mizan_admin_members','mizan_admin_orgs','mizan_admin_set_sub',
    'mizan_bump_invoice_seq','mizan_del_doc','mizan_doc_priv','mizan_get_invoice_seq',
    'mizan_get_subs_plans','mizan_list_docs','mizan_list_retired','mizan_next_code',
    'mizan_next_invoice_no','mizan_presence_heartbeat','mizan_retire_code',
    'mizan_set_subs_plans','mizan_treasury_next_local'];
  v_n int;
  v_miss text;
begin
  if v_scope = 'full' then
    v_tables := 'on';
  elsif v_scope not in ('admin', 'all') then
    raise exception '٤٩: mizan_49.scope مش متظبّط (admin/all/full) — مافيش تنفيذ على عمي';
  end if;

  -- الدوال المستهدفة موجودة ووحيدة (مافيش overload يخلي الـ revoke يروح لغلط)
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_names);
  if v_n <> array_length(v_names, 1) then
    raise exception '٤٩: الدوال المستهدفة % بس اللي موجودة % — أعد القياس', array_length(v_names, 1), v_n;
  end if;
  select coalesce(string_agg(proname, ', '), '') into v_miss from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_names)
     group by p.proname having count(*) > 1) t;
  if v_miss <> '' then raise exception '٤٩: overload في: % — الوقف', v_miss; end if;

  -- مانقفلش التطبيق: كل دالة مستهدفة عندها EXECUTE لـ authenticated قبل السحب
  select coalesce(string_agg(p.proname, ', '), '') into v_miss
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_names)
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_miss <> '' then
    raise exception '٤٩: دوال مستهدفة ماعندهاش EXECUTE لـ authenticated: % — الوقف', v_miss;
  end if;

  -- مفيش سياسة بتستهدف anon صراحة (السياسات كلها TO PUBLIC في ميزان)
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and roles::text[] && array['anon'];
  if v_n <> 0 then raise exception '٤٩: % سياسة rolesها anon صراحة — الوقف للمراجعة', v_n; end if;

  raise notice '٤٩/قبل: النطاق % · % دالة مستهدفة · تنظيف جداول anon = %', v_scope, array_length(v_names, 1), v_tables;
end $$;

-- ═══ ٣) التنفيذ — منح بس، مفيش أي CREATE OR REPLACE ═══
do $$
declare
  v_scope text := coalesce(nullif(current_setting('mizan_49.scope', true), ''), '');
  v_tables text := coalesce(nullif(current_setting('mizan_49.anon_tables', true), ''), 'off');
  v_names text[] := array[
    'create_org_and_profile','current_org','join_org','mizan_access','mizan_add_doc',
    'mizan_admin_delete_org','mizan_admin_members','mizan_admin_orgs','mizan_admin_set_sub',
    'mizan_bump_invoice_seq','mizan_del_doc','mizan_doc_priv','mizan_get_invoice_seq',
    'mizan_get_subs_plans','mizan_list_docs','mizan_list_retired','mizan_next_code',
    'mizan_next_invoice_no','mizan_presence_heartbeat','mizan_retire_code',
    'mizan_set_subs_plans','mizan_treasury_next_local'];
  r record;
  n int := 0;
begin
  if v_scope = 'full' then v_tables := 'on'; end if;

  for r in execute $q$
      select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = any($1)
       order by p.proname
    $q$ using v_names
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
    n := n + 1;
  end loop;
  if n <> array_length(v_names, 1) then
    raise exception '٤٩: عدلت % دالة بس والمستهدف % — الوقف', n, array_length(v_names, 1);
  end if;

  if v_tables = 'on' then
    n := 0;
    for r in execute $qt$
        select c.oid, c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
         where ns.nspname = 'public' and c.relkind = 'r'
           and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
             or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
             or has_table_privilege('anon', c.oid, 'REFERENCES') or has_table_privilege('anon', c.oid, 'TRIGGER'))
         order by c.relname
      $qt$
    loop
      execute format('revoke all on table public.%I from anon', r.relname);
      n := n + 1;
    end loop;
    raise notice '٤٩/تنظيف: سحبت كل منح anon من % جدول', n;
  end if;
  raise notice '٤٩: سحبت PUBLIC/anon EXECUTE وثبّت authenticated لـ % دالة', n;
end $$;

-- ═══ ٤) بوابة «بعد» — تقارن باللقطة الحيّة، مش بأرقام قديمة ═══
do $$
declare
  v_names text[] := array[
    'create_org_and_profile','current_org','join_org','mizan_access','mizan_add_doc',
    'mizan_admin_delete_org','mizan_admin_members','mizan_admin_orgs','mizan_admin_set_sub',
    'mizan_bump_invoice_seq','mizan_del_doc','mizan_doc_priv','mizan_get_invoice_seq',
    'mizan_get_subs_plans','mizan_list_docs','mizan_list_retired','mizan_next_code',
    'mizan_next_invoice_no','mizan_presence_heartbeat','mizan_retire_code',
    'mizan_set_subs_plans','mizan_treasury_next_local'];
  v_tables text := coalesce(nullif(current_setting('mizan_49.anon_tables', true), ''), 'off');
  v_scope text := coalesce(nullif(current_setting('mizan_49.scope', true), ''), '');
  v_left text;
  v_n int;
  v_b mizan_49_live_before%rowtype;
  v_a mizan_49_live_before%rowtype;
begin
  -- صفر منح زائر/عام على المستهدف
  select coalesce(string_agg(x, ', ' order by x), '') into v_left from (
    select p.proname || '→' || case when a.grantee = 0 then 'PUBLIC' else 'anon' end x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join aclexplode(p.proacl) a on true
     where n.nspname = 'public' and p.proname = any(v_names)
       and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)) t;
  if v_left <> '' then raise exception '٤٩/بعد: لسه فيه منح زائر/عام: %', v_left; end if;

  -- authenticated لسه شغالة
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_names)
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_n <> array_length(v_names, 1) then
    raise exception '٤٩/بعد: authenticated فقدت EXECUTE على % من % دالة', array_length(v_names, 1) - v_n, array_length(v_names, 1);
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_names) and p.proacl is null;
  if v_n <> 0 then raise exception '٤٩/بعد: % دالة proaclها NULL', v_n; end if;

  -- المخطط والأجسام ما اتغيروش (مقاسين قبل التنفيذ في نفس المعاملة)
  select * into v_b from mizan_49_live_before;
  select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
    (select count(*) from pg_policies where schemaname = 'public'),
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity),
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'SELECT')),
    (select md5(string_agg(p.proname || '=' || md5(p.prosrc), E'\n' order by p.proname || '=' || md5(p.prosrc)))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
    into v_a;
  if v_a.fns <> v_b.fns or v_a.pols <> v_b.pols or v_a.rls_tables <> v_b.rls_tables
     or v_a.auth_tables <> v_b.auth_tables or v_a.fingerprint <> v_b.fingerprint then
    raise exception '٤٩/بعد: المخطط/الأجسام اتغيرت! قبل (%) بعد (%)', v_b::text, v_a::text;
  end if;

  if v_scope = 'full' and v_tables = 'on' then
    select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
         or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
         or has_table_privilege('anon', c.oid, 'REFERENCES') or has_table_privilege('anon', c.oid, 'TRIGGER'));
    if v_n <> 0 then raise exception '٤٩/بعد: لسه % جدول فيه منح anon', v_n; end if;
  end if;

  raise notice '٤٩/بعد ✓ صفر منح عام/زائر على المستهدف · authenticated كاملة · المخطط ثابت: % دالة / % سياسة / % جدول RLS',
    v_a.fns, v_a.pols, v_a.rls_tables;
end $$;

-- بعد تغيير المنح، PostgREST محتاج يعيد قراءة كتالوج الصلاحيات
notify pgrst, 'reload schema';
