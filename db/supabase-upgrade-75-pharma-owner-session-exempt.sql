-- ============================================================================
-- ترحيل ٧٥ — «ميزان فارما»: استثناء مالك البرنامج (adel) من قفل الجهاز الفردي
-- ----------------------------------------------------------------------------
-- طلب المالك الصريح: «Owner adel is exempt from the single-session device lock;
-- all other accounts remain subject to it.»
-- الدوال الثلاث من ترقية ٧٢ بتترجّع بنسخة مطابقة + سطر استثناء واحد في أول كل
-- دالة. بقية الحسابات سلوكها بالظبط زي ما هو: جهاز واحد فقط في كل وقت.
-- الترحيل idempotent وما بيلمسش منطق الدخول/الباسورد/الاشتراكات/الدعوات.
-- ============================================================================

-- أي صف قديم لـ adel يتشال مرة واحدة؛ من دلوقتي الدوال ما بترجعوش ينشئوه.
delete from public.mizan_sessions where username = 'adel';

create or replace function public.mizan_session_claim(p_user text, p_device text, p_session text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key  text := lower(btrim(coalesce(p_user, '')));
  v_dev  text := btrim(coalesce(p_device, ''));
  v_sid  text := coalesce(p_session, '');
  v_row  public.mizan_sessions%rowtype;
  v_ttl  integer := public.mizan_session_ttl();
begin
  if v_key = '' or v_dev = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;

  -- 🔓 المالك مستثنى: أي عدد من الأجهزة يقدر يفتح حسابه في نفس الوقت.
  if v_key = 'adel' then
    delete from public.mizan_sessions where username = v_key;
    return jsonb_build_object('ok', true, 'busy', false, 'exempt', true);
  end if;

  insert into public.mizan_sessions(username, device_id, session_id, last_seen)
  values (v_key, v_dev, v_sid, now())
  on conflict (username) do nothing;

  select * into v_row from public.mizan_sessions where username = v_key for update;

  -- نفس الجهاز ⇒ تجديد عادي (تحديث الصفحة/إعادة الفتح ما تقفلش على صاحبها)
  if v_row.device_id = v_dev then
    update public.mizan_sessions
       set session_id = v_sid, last_seen = now()
     where username = v_key;
    return jsonb_build_object('ok', true, 'busy', false, 'same_device', true);
  end if;

  -- جهاز تاني والجلسة لسه حيّة ⇒ ممنوع
  if v_row.last_seen > now() - make_interval(secs => v_ttl) then
    return jsonb_build_object('ok', false, 'busy', true,
                              'last_seen', to_char(v_row.last_seen, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  end if;

  -- الجلسة القديمة سقطت (مفيش نبضة) ⇒ الجهاز الجديد ياخدها
  update public.mizan_sessions
     set device_id = v_dev, session_id = v_sid, last_seen = now()
   where username = v_key;
  return jsonb_build_object('ok', true, 'busy', false, 'took_over', true);
end;
$$;

create or replace function public.mizan_session_beat(p_user text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_user, '')));
  v_dev text := btrim(coalesce(p_device, ''));
begin
  if v_key = '' or v_dev = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;

  -- 🔓 المالك مستثنى: النبضة ما تعملش lost أبدًا.
  if v_key = 'adel' then
    return jsonb_build_object('ok', true, 'exempt', true);
  end if;

  update public.mizan_sessions
     set last_seen = now()
   where username = v_key and device_id = v_dev;
  if not found then
    return jsonb_build_object('ok', false, 'lost', true);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mizan_session_release(p_user text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_user, '')));
  v_dev text := btrim(coalesce(p_device, ''));
begin
  if v_key = '' or v_dev = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;

  -- 🔓 خروج المالك ما يأثرش على باقي أجهزته (مفيش صف أصلاً).
  if v_key = 'adel' then
    delete from public.mizan_sessions where username = v_key;
    return jsonb_build_object('ok', true, 'exempt', true);
  end if;

  delete from public.mizan_sessions where username = v_key and device_id = v_dev;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mizan_session_claim(text, text, text) from public, anon;
revoke all on function public.mizan_session_beat(text, text) from public, anon;
revoke all on function public.mizan_session_release(text, text) from public, anon;
grant execute on function public.mizan_session_claim(text, text, text) to authenticated;
grant execute on function public.mizan_session_beat(text, text) to authenticated;
grant execute on function public.mizan_session_release(text, text) to authenticated;

notify pgrst, 'reload schema';
