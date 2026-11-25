-- ترقية ٧٩ — استعادة سجل الإجراءات السحابي المشترك (mizan_log_activity)
-- التاريخ: 25/11/2026 · بناء 8
-- الغرض: الدالة دي كانت جزء من ترقية ٢٨ في البرنامج الأصلي (db-admin/upgrade-28-activity-log.sql)
--        وما دخلتش حزمة الترقيات المنشورة ⇒ على المشروع المستقل كل نداء بيرجع 404،
--        وسجل الإجراءات المشترك بين كل مستخدمي الشركة ما بيattachش. الترقية دي تعيد تعريفها
--        بنفس السلوك الموثّق: الشركة تُقرأ من current_org() جوه القاعدة (بلا org_id من العميل)،
--        user_name = الاسم الحقيقي، local_id = max+1، ومنح authenticated بس.
-- آمنة للتكرار (idempotent) — بلا begin/commit. صفر تعديل على أي صف موجود.

create or replace function public.mizan_log_activity(p_action text, p_detail text)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $function$
declare
  v_org  uuid := public.current_org();
  v_name text;
  v_id   bigint;
begin
  if v_org is null then
    raise exception 'لا توجد شركة مرتبطة بهذا الحساب';
  end if;

  select coalesce(p.full_name, split_part(u.email, '@', 1))
    into v_name
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.id = auth.uid();

  select coalesce(max(a.local_id), 0) + 1
    into v_id
    from public.audit_logs a
   where a.org_id = v_org;

  insert into public.audit_logs (org_id, ts, user_name, action, detail, local_id)
  values (v_org, now(), coalesce(v_name, ''), p_action, p_detail, v_id);
end $function$;

revoke all on function public.mizan_log_activity(text, text) from public, anon;
grant execute on function public.mizan_log_activity(text, text) to authenticated;

-- فحص بعدي: الدالة موجودة بتوقيعها، والمنح لـ authenticated، وممنوعة للزائر.
do $do$
declare
  v_sig  int;
  v_grant text;
  v_anon int;
begin
  select count(*) into v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mizan_log_activity'
     and p.prokind='f' and pg_get_function_arguments(p.oid)='p_action text, p_detail text';
  if v_sig <> 1 then
    raise exception 'فحص ٧٩ بعدي: توقيع الدالة (%) مش واحدة', v_sig;
  end if;

  select coalesce(string_agg(p.proname, ',' order by p.proname), '') into v_grant
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mizan_log_activity'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_grant <> 'mizan_log_activity' then
    raise exception 'فحص ٧٩ بعدي: منح authenticated مفقود (%)', v_grant;
  end if;

  select count(*) into v_anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mizan_log_activity'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon <> 0 then
    raise exception 'فحص ٧٩ بعدي: anon لسه بيقدر ينفّذ الدالة (%)', v_anon;
  end if;
end
$do$;
