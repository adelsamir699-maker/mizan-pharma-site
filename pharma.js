/* ================================================================
   ميزان فارما — الطبقة الصيدلانية الإضافية
   By Adel Samir - واتس: 01002655282

   قواعد حاكمة:
   - لا لمس لمنطق الدخول/الباسورد/الاشتراكات/الدعوات في app.js.
   - كل بيانات الصيدلية في مفتاح localStorage مستقل ومقسّم لكل شركة.
   - لا تُكتب بيانات صيدلية على Supabase القديم إطلاقًا.
   ================================================================ */
(function () {
  "use strict";

  var A = null;
  var bound = false;
  var LS_PHARMA = "mizan_pharma_data_v1";
  var CACHE = null;     // نسخة محمّلة من Supabase؛ localStorage هو الـ fallback في الوضع المحلي
  var hydrated = false; // بوابة البيع تستنى لحد ما البيانات تتنزّل قبل ما تفتح الشاشة
  var RX = { active: false, patient: "", doctor: "", no: "", date: "", note: "" };

  var META_FIELDS = {
    fPActiveIngredient: "activeIngredient",
    fPManufacturer: "manufacturer",
    fPRegistration: "registrationNo",
    fPForm: "form",
    fPStrength: "strength",
    fPStripsPerBox: "stripsPerBox",
    fPStorage: "storage",
    fPPharmaNotes: "notes"
  };

  function $ (id) { return document.getElementById(id); }
  function h (s) {
    if (A && typeof A.esc === "function") return A.esc(s);
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money (n) {
    if (A && typeof A.fmt === "function") return A.fmt(n);
    return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US");
  }
  function num (v) { return Math.round((parseFloat(String(v || "").replace(/,/g, "")) || 0) * 100) / 100; }
  /* عدد الشرائط: رقم صحيح موجب، والصفر معناه «مفيش تقسيم» (سعر العلبة زي ما هو).
     الحد الأعلى 500 عشان القائمة المنسدلة في الفاتورة ما تعرضش آلاف الخيارات. */
  var MAX_STRIPS = 500;
  function asciify (v) {
    return String(v == null ? "" : v)
      .replace(/[٠-٩]/g, function (d) { return String("٠١٢٣٤٥٦٧٨٩".indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)); })
      .replace(/[٬,]/g, "").trim();
  }
  function stripsCount (v) {
    var s = asciify(v);
    if (!s) return 0;
    var n = Math.floor(Number(s));
    if (!isFinite(n) || n < 0) return 0;
    return n > MAX_STRIPS ? MAX_STRIPS : n;
  }
  function iso (d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function today () { return iso(new Date()); }
  function daysLeft (exp) {
    if (!exp) return 99999;
    var a = new Date(String(exp) + "T00:00:00");
    var b = new Date(today() + "T00:00:00");
    if (isNaN(a.getTime())) return 99999;
    return Math.floor((a.getTime() - b.getTime()) / 86400000);
  }
  function batchStatus (b) {
    var d = daysLeft(b && b.expiry);
    if (d < 0) return { key: "expired", label: "منتهية" };
    if (d <= 30) return { key: "soon", label: "تقارب الانتهاء" };
    return { key: "ok", label: "سارية" };
  }

  function storeKey () {
    var org = (A && typeof A.orgId === "function") ? A.orgId() : null;
    return LS_PHARMA + (org ? ":" + org : ":local");
  }
  function blank () { return { products: {}, dispenses: [] }; }
  // بناء 9: أي فشل في مسار الصيدلية لازم يظهر — في الكونسول على الأقل،
  // وللمستخدم في الحالات اللي بتغيّر الرصيد أو البيانات.
  function fail (what, e, userMsg) {
    try { console.warn("PHARMA " + what, e); } catch (ignore) { }
    if (userMsg) { try { notify(userMsg, "warning"); } catch (ignore) { } }
  }
  function load () {
    if (CACHE) return JSON.parse(JSON.stringify(CACHE));
    try {
      var d = JSON.parse(localStorage.getItem(storeKey()) || "null");
      if (!d || typeof d !== "object") return blank();
      d.products = d.products && typeof d.products === "object" ? d.products : {};
      d.dispenses = Array.isArray(d.dispenses) ? d.dispenses : [];
      return d;
    } catch (e) { fail("قراءة الكاش المحلي", e); return blank(); }
  }
  function save (d) {
    CACHE = JSON.parse(JSON.stringify(d || blank()));
    try { localStorage.setItem(storeKey(), JSON.stringify(CACHE)); } catch (e) { fail("حفظ الكاش المحلي", e); }
  }
  function queueCloud (p, what) {
    if (!p || typeof p.catch !== "function") return;
    p.catch(function (e) {
      try { console.warn("PHARMA cloud " + what, e); } catch (e2) { }
      try { notify("تعذّر حفظ بيانات الصيدلية على السحابة — راجع الاتصال.", "warning"); } catch (e3) { }
    });
  }
  function sqlDate (v) { var s = String(v == null ? "" : v).trim(); return s ? s.slice(0, 10) : ""; }

  /* تحويل صفوف Supabase إلى نفس الشكل اللي بتستخدمه دوال الرسم/الصرف */
  function pharmaHydrate (payload) {
    // لو السحب فشل في وضع السحابة ما نفتحش البيع على نسخة localStorage قديمة.
    if (!payload || !payload.meta) { hydrated = !(A && A.online); return; }
    var d = blank();
    (payload.meta || []).forEach(function (r) {
      if (!r || r.deleted === true) return;
      var k = String(r.local_id);
      if (!d.products[k]) d.products[k] = { meta: {}, batches: [] };
      d.products[k].meta = {
        activeIngredient: r.active_ingredient || "",
        manufacturer: r.manufacturer || "",
        registrationNo: r.registration_no || "",
        form: r.form || "",
        strength: r.strength || "",
        stripsPerBox: stripsCount(r.strips_per_box),
        storage: r.storage || "",
        notes: r.notes || "",
        rxRequired: r.rx_required === true
      };
    });
    (payload.batches || []).forEach(function (r) {
      if (!r || r.deleted === true) return;
      var k = String(r.product_local_id);
      if (!d.products[k]) d.products[k] = { meta: {}, batches: [] };
      d.products[k].batches.push({
        id: String(r.local_id), no: r.batch_no || "", expiry: sqlDate(r.expiry_date),
        qty: num(r.qty), cost: num(r.cost), warehouse: r.warehouse || "",
        status: r.status || "active", stockAdded: r.stock_added === true
      });
    });
    d.dispenses = (payload.dispenses || []).filter(function (r) { return r && r.deleted !== true; }).map(function (r) {
      return {
        id: String(r.local_id), date: sqlDate(r.doc_date), invoiceNo: r.invoice_no || "",
        saleId: r.sale_local_id, productId: r.product_local_id, code: r.product_code || "",
        nameAr: r.product_name || "", qty: num(r.qty), batchNo: r.batch_info || "",
        expiry: sqlDate(r.expiry_date), patient: r.patient_name || "", doctor: r.doctor_name || "",
        rxNo: r.rx_no || "", needsReconcile: r.needs_reconcile === true,
        batchRefs: Array.isArray(r.batch_refs) ? r.batch_refs : [], note: r.notes || ""
      };
    });
    CACHE = d;
    try { localStorage.setItem(storeKey(), JSON.stringify(CACHE)); } catch (e) { fail("حفظ كاش بعد التحميل السحابي", e); }
    hydrated = true;
    try { renderBatches(); renderDispenses(); renderReports(); renderRxStatus(); } catch (e) { fail("رسم شاشات الصيدلية بعد التحميل", e); }
  }
  // بناء 11: نفس منطق entry لكن على نسخة محمّلة مرة واحدة — منع نسخ الكاش آلاف المرات.
  function entryIn (d, productId, create) {
    var k = String(productId);
    if (!d.products[k] && create) d.products[k] = { meta: {}, batches: [] };
    var r = d.products[k] || { meta: {}, batches: [] };
    r.meta = r.meta && typeof r.meta === "object" ? r.meta : {};
    r.batches = Array.isArray(r.batches) ? r.batches : [];
    return { d: d, k: k, r: r };
  }
  function entry (productId, create) {
    return entryIn(load(), productId, create);
  }
  function products () {
    return (A && typeof A.products === "function") ? (A.products() || []) : [];
  }
  function findProduct (id) {
    var list = products();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }
  function notify (msg, kind) {
    if (A && typeof A.toast === "function") A.toast(msg, kind || "info");
  }

  /* ---------- بيانات الدواء في نافذة الصنف ---------- */
  function fillMetaForm (product) {
    var r = entry(product ? product.id : null, false).r;
    var m = r.meta || {};
    Object.keys(META_FIELDS).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (id === "fPStripsPerBox") {
        var n = stripsCount(m.stripsPerBox);
        el.value = n > 0 ? String(n) : "";
      } else {
        el.value = m[META_FIELDS[id]] || "";
      }
    });
    // بناء 10: اختيار «لا يُصرف إلا بوصفة» اتلغى — مفيش عرض ولا استخدام للعلم القديم.
  }
  function readMetaForm () {
    var m = {};
    Object.keys(META_FIELDS).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (id === "fPStripsPerBox") {
        var typed = asciify(el.value);
        var n = stripsCount(typed);
        if (typed && (n !== Number(typed) || n < 1)) {
          notify("عدد الشرائط بالعلبة لازم يكون رقم صحيح من 1 إلى " + MAX_STRIPS + " — اتضبط على " + (n || 0) + ".", "warning");
        }
        m[META_FIELDS[id]] = n;
      } else {
        m[META_FIELDS[id]] = String(el.value || "").trim();
      }
    });
    // بناء 10: أي علم روشته قديم يترجع false — الصنف دايمًا متاح للبيع بدون روشته.
    m.rxRequired = false;
    return m;
  }

  /* ---------- الدفعات ---------- */
  function warehouseMatch (b, wh) {
    return !b.warehouse || !wh || String(b.warehouse) === String(wh);
  }
  function liveBatches (batches, wh) {
    return (batches || []).filter(function (b) {
      return b && b.status !== "blocked" && num(b.qty) > 0 && daysLeft(b.expiry) >= 0 && warehouseMatch(b, wh);
    });
  }
  function availableQty (productId, wh) {
    var r = entry(productId, false).r;
    return liveBatches(r.batches, wh).reduce(function (s, b) { return s + num(b.qty); }, 0);
  }
  function sortedBatches (batches) {
    return (batches || []).slice().sort(function (a, b) {
      var x = String(a.expiry || "9999-12-31");
      var y = String(b.expiry || "9999-12-31");
      if (x !== y) return x.localeCompare(y);
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }
  // بناء 11: كل الدفعات من نسخة واحدة محمّلة — ما فيش clone لكل صنف على حدة.
  function collectBatchRows (d) {
    var out = [];
    products().forEach(function (p) {
      var x = entryIn(d, p.id, false).r;
      (x.batches || []).forEach(function (b) {
        if (b && typeof b === "object") out.push({ p: p, b: b });
      });
    });
    return out;
  }
  function sortedBatchRows (rows) {
    var byRef = new Map();
    rows.forEach(function (r) { byRef.set(r.b, r); });
    return sortedBatches(rows.map(function (r) { return r.b; }))
      .map(function (b) { return byRef.get(b) || null; })
      .filter(Boolean);
  }
  function consumeBatches (batches, qty, wh) {
    var left = num(qty);
    var taken = 0;
    var lines = [];
    var used = [];
    var firstExpiry = "";
    var list = sortedBatches(liveBatches(batches, wh));
    for (var i = 0; i < list.length && left > 0.00001; i++) {
      var b = list[i];
      var take = Math.min(left, num(b.qty));
      b.qty = num(num(b.qty) - take);
      left = num(left - take);
      taken = num(taken + take);
      used.push({ id: String(b.id), qty: take, no: b.no || "", expiry: b.expiry || "", warehouse: b.warehouse || wh || "" });
      lines.push(String(b.no || "—") + " (" + (b.expiry || "—") + ") × " + money(take));
      if (!firstExpiry) firstExpiry = b.expiry || "";
    }
    return { lines: lines, firstExpiry: firstExpiry, taken: taken, used: used, ok: left <= 0.00001 };
  }

  /* ---------- تحويل السجلات المحلية إلى صفوف Supabase ---------- */
  function cloudBatchRow (b, p) {
    return {
      local_id: String(b.id), product_local_id: Number(p && p.id), product_code: (p && p.code) || "",
      batch_no: b.no || "", expiry_date: sqlDate(b.expiry) || null, qty: num(b.qty), cost: num(b.cost),
      warehouse: b.warehouse || "", status: b.status === "blocked" ? "blocked" : "active",
      stock_added: b.stockAdded === true, deleted: false
    };
  }
  function cloudMetaRow (m, p) {
    return {
      local_id: Number(p && p.id), product_code: (p && p.code) || "",
      active_ingredient: m.activeIngredient || "", manufacturer: m.manufacturer || "",
      registration_no: m.registrationNo || "", form: m.form || "", strength: m.strength || "",
      strips_per_box: stripsCount(m.stripsPerBox),
      storage: m.storage || "", rx_required: !!m.rxRequired, notes: m.notes || "", deleted: false
    };
  }
  function cloudDispenseRow (r) {
    return {
      local_id: String(r.id), sale_local_id: r.saleId != null ? Number(r.saleId) : null,
      invoice_no: r.invoiceNo || "", doc_date: sqlDate(r.date) || null,
      product_local_id: Number(r.productId), product_code: r.code || "", product_name: r.nameAr || "",
      qty: num(r.qty), batch_info: r.batchNo || "", expiry_date: sqlDate(r.expiry) || null,
      patient_name: r.patient || "", doctor_name: r.doctor || "", rx_no: r.rxNo || "",
      notes: r.note || "", needs_reconcile: r.needsReconcile === true,
      batch_refs: Array.isArray(r.batchRefs) ? r.batchRefs : [], deleted: r.deleted === true
    };
  }
  function cloudUpsert (table, row) {
    return (A && typeof A.pharmaUpsert === "function") ? A.pharmaUpsert(table, row) : null;
  }
  function cloudRemove (table, localId) {
    return (A && typeof A.pharmaRemove === "function") ? A.pharmaRemove(table, localId) : null;
  }

  /* ---------- بوابة البيع ---------- */
  function validateSale (payload) {
    var items = (payload && payload.items) || [];
    var wh = (payload && payload.warehouse) || "";
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var p = findProduct(it.productId);
      if (!p) continue;
      var x = entry(p.id, false);
      var name = p.nameAr || p.code || "صنف";
      /* بناء 10 (طلب المالك): الوصفة مش شرط للبيع في ميزان فارما — الفاتورة بتتحفظ
         من غير روشته. الفحص الوحيد اللي لسه شغّال هنا هو فحص الدفعات/الصلاحية.
         علم rxRequired القديم اتجاهل بالكامل (ما مسحناش بيانات موجودة). */
      if ((x.r.batches || []).length > 0) {
        var avail = availableQty(p.id, wh);
        if (avail + 0.00001 < num(it.qty)) {
          return "الكمية الصالحة المتاحة من («" + name + "») في " + (wh || "المستودع") +
            " = " + money(avail) + " — الدفعات المنتهية أو غير المسجّلة لا تُصرف.";
        }
      }
    }
    return "";
  }

  /* ---------- تسجيل الصرف بعد حفظ الفاتورة ---------- */
  function posInvoiceSaved (payload) {
    var inv = (payload && payload.invoice) || {};
    var items = (payload && payload.items) || [];
    var wh = (payload && payload.warehouse) || inv.warehouse || "";
    var d = load();
    var recs = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var p = findProduct(it.productId);
      if (!p) continue;
      var x = d.products[String(p.id)] || { meta: {}, batches: [] };
      x.batches = Array.isArray(x.batches) ? x.batches : [];
      var alloc = consumeBatches(x.batches, it.qty, wh);
      var short = alloc.ok ? 0 : num(num(it.qty) - alloc.taken);
      // الفاتورة بيتخصم رصيدها قبل استدعاء الهوك — لو الدفعات ما كفتش، نرجّع الفرق عشان
      // الرصيد يفضل مطابق لمجموع الدفعات، ونعلّم الصرف إنه محتاج مراجعة.
      if (short > 0 && A && typeof A.addStockAt === "function") {
        var fixed = true;
        try { A.addStockAt(p, wh, short); A.saveProducts(); }
        catch (e) {
          fixed = false;
          fail("تسوية الرصيد بعد الصرف", e,
            "تعذّر تسوية رصيد " + (p.nameAr || p.code || "الصنف") + " — راجع المخزون يدويًا.");
        }
        if (fixed) {
          notify("الكمية المتاحة من الدفعات (" + money(alloc.taken) + ") أقل من الكمية المصروفة (" +
            money(it.qty) + ") — تمت تسوية الرصيد. راجع الدفعات.", "warning");
        }
      }
      d.products[String(p.id)] = x;
      var refs = (alloc.used || []).map(function (u) {
        return { id: u.id, qty: u.qty, no: u.no, expiry: u.expiry, warehouse: u.warehouse, productId: p.id };
      });
      alloc.used.forEach(function (u) {
        for (var j = 0; j < x.batches.length; j++) {
          if (String(x.batches[j].id) === String(u.id)) {
            queueCloud(cloudUpsert("pharma_batches", cloudBatchRow(x.batches[j], p)), "batch dispense");
            break;
          }
        }
      });
      recs.push({
        id: "d" + Date.now() + "-" + i,
        date: inv.invoiceDate || inv.date || today(),
        invoiceNo: inv.invoiceNumber || inv.invoiceNo || "",
        saleId: inv.id != null ? inv.id : (inv.saleId != null ? inv.saleId : null),
        productId: p.id,
        code: it.code || p.code || "",
        nameAr: it.nameAr || p.nameAr || "",
        qty: num(it.qty),
        batchNo: alloc.lines.length ? alloc.lines.join(" | ") : "بدون دفعة مسجّلة",
        expiry: alloc.firstExpiry || "",
        // بناء 10: سجل الصرف ما بيحمل أي بيانات روشته — الفاتورة مستقلة عنها تمامًا.
        patient: "",
        doctor: "",
        rxNo: "",
        needsReconcile: short > 0,
        batchRefs: refs,
        note: short > 0 ? "راجع تخصيص الدفعات" : ""
      });
    }
    if (!recs.length) return;
    d.dispenses = recs.concat(d.dispenses || []).slice(0, 4000);
    save(d);
    recs.forEach(function (r) { queueCloud(cloudUpsert("pharma_dispenses", cloudDispenseRow(r)), "dispense save"); });
    RX = { active: false, patient: "", doctor: "", no: "", date: "", note: "" };
    renderRxStatus();
    renderBatches();
    renderDispenses();
    renderReports();
  }

  /* ---------- الرسم ---------- */
  function fillSelect (el, list, selected, placeholder) {
    if (!el) return;
    el.innerHTML = "";
    if (placeholder) {
      var op0 = document.createElement("option");
      op0.value = "";
      op0.textContent = placeholder;
      el.appendChild(op0);
    }
    list.forEach(function (row) {
      var op = document.createElement("option");
      op.value = String(row.id);
      op.textContent = row.label;
      el.appendChild(op);
    });
    if (selected != null) el.value = String(selected);
  }
  function fillProductSelect (selected) {
    var list = products().filter(function (p) { return p && p.isActive !== false; })
      .map(function (p) { return { id: p.id, label: (p.code ? p.code + " — " : "") + (p.nameAr || "") }; });
    fillSelect($("phBatchProduct"), list, selected, "— اختر الصنف —");
  }
  function fillWhSelect (selected) {
    var list = (A && typeof A.warehouses === "function" ? A.warehouses() : [])
      .map(function (w) { return { id: w, label: w }; });
    var first = list.length ? list[0].id : "";
    fillSelect($("phBatchWh"), list, selected || first, "");
  }
  function badge (b) {
    var s = batchStatus(b);
    return '<span class="pharma-badge ' + s.key + '">' + s.label + "</span>";
  }
  function renderBatches () {
    var tb = $("phBatchesTable");
    if (!tb) return;
    var body = tb.querySelector("tbody");
    // بناء 11: نسخة واحدة من الكاش + بحث Map بدل مقارنة كل صف بكل صف.
    var rows = sortedBatchRows(collectBatchRows(load()));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="invq-empty">مافيش دفعات مسجّلة لسه — سجّل أول دفعة من النموذج فوق.</td></tr>';
      return;
    }
    // سلسلة HTML واحدة بدل آلاف عمليات innerHTML/appendChild.
    body.innerHTML = rows.map(function (row) {
      var p = row.p, b = row.b;
      return '<tr data-pid="' + h(p.id) + '" data-bid="' + h(b.id) + '">' +
        "<td>" + h(p.nameAr || p.code) + "</td>" +
        "<td>" + h(b.no) + "</td>" +
        "<td>" + h(b.expiry || "—") + "</td>" +
        "<td>" + money(b.qty) + "</td>" +
        "<td>" + h(b.warehouse || "—") + "</td>" +
        "<td>" + badge(b) + "</td>" +
        '<td><button class="btn small teal" type="button" data-act="label">🏷️ ملصق</button> ' +
        '<button class="btn small red" type="button" data-act="del">🗑️ حذف</button></td></tr>';
    }).join("");
  }
  function renderDispenses () {
    var tb = $("phDispenseTable");
    if (!tb) return;
    var body = tb.querySelector("tbody");
    var rows = (load().dispenses || []).slice(0, 400);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="invq-empty">مافيش عمليات صرف مسجّلة لسه.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      return '<tr data-rid="' + h(r.id) + '">' +
        "<td>" + h(r.date) + "</td>" +
        "<td>" + h(r.patient || "—") + "</td>" +
        "<td>" + h(r.nameAr || r.code) + "</td>" +
        "<td>" + money(r.qty) + "</td>" +
        "<td>" + h(r.batchNo) + "</td>" +
        "<td>" + h(r.invoiceNo) + "</td>" +
        '<td><button class="btn small teal" type="button" data-act="rxlabel">🏷️ ملصق</button></td></tr>';
    }).join("");
  }
  function renderReports () {
    var k = $("phReportsKpis");
    var tb = $("phExpiryTable");
    if (!k || !tb) return;
    var d = load();
    var all = collectBatchRows(d);
    var exp = all.filter(function (r) { return daysLeft(r.b.expiry) < 0; });
    var soon = all.filter(function (r) { var n = daysLeft(r.b.expiry); return n >= 0 && n <= 30; });
    var todayCount = (d.dispenses || []).filter(function (r) { return String(r.date) === today(); }).length;
    k.innerHTML =
      '<div class="pharma-kpi"><b>' + all.length + "</b><span>دفعات مسجّلة</span></div>" +
      '<div class="pharma-kpi"><b>' + soon.length + "</b><span>تنتهي خلال 30 يوم</span></div>" +
      '<div class="pharma-kpi"><b>' + exp.length + "</b><span>دفعات منتهية</span></div>" +
      '<div class="pharma-kpi"><b>' + todayCount + "</b><span>عمليات صرف اليوم</span></div>";
    var body = tb.querySelector("tbody");
    var rows = sortedBatchRows(all);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="invq-empty">مافيش دفعات لتقرير الصلاحية.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var days = daysLeft(r.b.expiry);
      return "<tr>" +
        "<td>" + h(r.p.nameAr || r.p.code) + "</td>" +
        "<td>" + h(r.b.no) + "</td>" +
        "<td>" + h(r.b.expiry || "—") + "</td>" +
        "<td>" + money(r.b.qty) + "</td>" +
        "<td>" + money(r.b.cost) + "</td>" +
        "<td>" + money(num(r.b.qty) * num(r.b.cost)) + "</td>" +
        "<td>" + (days >= 99999 ? "—" : days) + "</td>" +
        "<td>" + badge(r.b) + "</td></tr>";
    }).join("");
  }
  function renderRxStatus () {
    var el = $("phRxStatus");
    if (!el) return;
    // بناء 11: الوصفة ملغية تمامًا — سجل الصرف بيتعمل تلقائيًا مع كل فاتورة.
    el.textContent = "الصرف بيتسجّل تلقائيًا مع كل فاتورة مبيعات — مفيش روشته مطلوبة.";
  }
  function openView () {
    if (!A) return;
    bind();
    fillProductSelect($("phBatchProduct") ? $("phBatchProduct").value : null);
    fillWhSelect($("phBatchWh") ? $("phBatchWh").value : null);
    var dt = $("phRxDate");
    if (dt && !dt.value) dt.value = today();
    renderBatches();
    renderDispenses();
    renderReports();
    renderRxStatus();
  }

  /* ---------- الطباعة ---------- */
  function printHtml (title, html) {
    var el = $("pharmaPrintArea");
    if (!el) {
      el = document.createElement("div");
      el.id = "pharmaPrintArea";
      el.className = "print-only pharma-print";
      document.body.appendChild(el);
    }
    el.innerHTML = "<h2>" + h(title) + "</h2>" + html;
    if (A && typeof A.printSection === "function") A.printSection(el);
    else window.print();
  }
  function tableHtml (heads, rows) {
    return "<table><thead><tr>" + heads.map(function (x) { return "<th>" + h(x) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr>" + r.map(function (c) { return "<td>" + h(c) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }

  /* ---------- الأحداث ---------- */
  function saveBatch () {
    var sel = $("phBatchProduct");
    var p = sel ? findProduct(sel.value) : null;
    if (!p) { notify("اختر الصنف الدوائي أولًا.", "warning"); return; }
    var no = String(($("phBatchNo") || {}).value || "").trim();
    var exp = String(($("phBatchExpiry") || {}).value || "");
    var qty = num(($("phBatchQty") || {}).value);
    var cost = num(($("phBatchCost") || {}).value);
    var wh = String(($("phBatchWh") || {}).value || "");
    if (!no) { notify("اكتب رقم الدفعة.", "warning"); return; }
    if (!exp) { notify("اختر تاريخ انتهاء الصلاحية.", "warning"); return; }
    if (!(qty > 0)) { notify("الكمية المستلمة لازم تكون أكبر من صفر.", "warning"); return; }
    var x = entry(p.id, true);
    var clash = x.r.batches.some(function (b) { return String(b.no) === no && String(b.warehouse || "") === wh; });
    if (clash) { notify("رقم الدفعة ده مسجّل قبل كده لنفس الصنف والمستودع.", "warning"); return; }
    var addStock = $("phBatchAddStock");
    var stockAdded = !!(addStock && addStock.checked);
    var batch = {
      id: "b" + Date.now() + "-" + Math.floor(Math.random() * 10000),
      no: no, expiry: exp, qty: qty, cost: cost, warehouse: wh,
      stockAdded: stockAdded,
      status: "active", addedAt: new Date().toISOString()
    };
    x.r.batches.push(batch);
    save(x.d);
    queueCloud(cloudUpsert("pharma_batches", cloudBatchRow(batch, p)), "batch save");
    if (stockAdded && A) {
      try { A.addStockAt(p, wh, qty); A.saveProducts(); }
      catch (e) {
        fail("زيادة رصيد الدفعة", e,
          "اتحفظت الدفعة بس الرصيد ما اتزودش — راجع المخزون يدويًا.");
      }
    }
    if (A && typeof A.addActivity === "function") {
      A.addActivity("استلام دفعة صيدلية", p.nameAr + " — دفعة " + no + " — كمية " + money(qty));
    }
    if ($("phBatchNo")) $("phBatchNo").value = "";
    if ($("phBatchQty")) $("phBatchQty").value = "0";
    notify("تم حفظ الدفعة بنجاح.", "success");
    renderBatches();
    renderReports();
  }
  function deleteBatch (pid, bid) {
    var x = entry(pid, false);
    var idx = -1;
    for (var i = 0; i < x.r.batches.length; i++) {
      if (String(x.r.batches[i].id) === String(bid)) { idx = i; break; }
    }
    if (idx < 0) return;
    var b = x.r.batches[idx];
    if (!confirm("هل تحذف الدفعة «" + b.no + "»؟" + (num(b.qty) > 0 && b.stockAdded === true ? "\nالكمية المتبقية (" + money(b.qty) + ") هتخصم من رصيد المخزون." : ""))) return;
    x.r.batches.splice(idx, 1);
    save(x.d);
    queueCloud(cloudRemove("pharma_batches", b.id), "batch delete");
    // الدفعات القديمة اللي قبل العلم ده اعتبرها «ما أضافتش رصيد» عشان ما يحصلش سالب.
    if (num(b.qty) > 0 && b.stockAdded === true && A) {
      try { A.addStockAt(findProduct(pid), b.warehouse, -num(b.qty)); A.saveProducts(); }
      catch (e) {
        fail("خصم رصيد الدفعة المحذوفة", e,
          "اتحذفت الدفعة بس الرصيد ما اتخصمosh — راجع المخزون يدويًا.");
      }
    }
    renderBatches();
    renderReports();
  }
  function printBatchLabel (pid, bid) {
    var x = entry(pid, false);
    var p = findProduct(pid);
    var b = null;
    for (var i = 0; i < x.r.batches.length; i++) {
      if (String(x.r.batches[i].id) === String(bid)) { b = x.r.batches[i]; break; }
    }
    if (!b || !p) return;
    var html = '<div class="pharma-print-meta">' +
      "<div>الصنف: <b>" + h(p.nameAr || p.code) + "</b> — الكود: " + h(p.code) + "</div>" +
      "<div>المادة الفعالة: " + h((x.r.meta || {}).activeIngredient || "—") + " — التركيز: " + h((x.r.meta || {}).strength || "—") + "</div>" +
      "</div>" + tableHtml(["الدفعة", "الانتهاء", "الكمية", "المستودع", "باركود"], [[b.no, b.expiry, money(b.qty), b.warehouse || "—", p.barcode || "—"]]);
    printHtml("ملصق دفعة دوائية", html);
  }
  function printDispenseLabel (rid) {
    var d = load();
    var r = null;
    for (var i = 0; i < (d.dispenses || []).length; i++) {
      if (String(d.dispenses[i].id) === String(rid)) { r = d.dispenses[i]; break; }
    }
    if (!r) return;
    var html = '<div class="pharma-print-meta">' +
      "<div>المريض: <b>" + h(r.patient || "—") + "</b> — الطبيب: " + h(r.doctor || "—") + "</div>" +
      "<div>رقم الوصفة: " + h(r.rxNo || "—") + " — رقم الفاتورة: " + h(r.invoiceNo) + " — التاريخ: " + h(r.date) + "</div>" +
      "</div>" + tableHtml(["الصنف", "الكمية", "الدفعة"], [[r.nameAr, money(r.qty), r.batchNo]]);
    printHtml("ملصق صرف دواء", html);
  }
  function printReport () {
    var tb = $("phExpiryTable");
    if (!tb) return;
    var heads = [], rows = [];
    tb.querySelectorAll("thead th").forEach(function (x) { heads.push(x.textContent); });
    tb.querySelectorAll("tbody tr").forEach(function (tr) {
      var row = [];
      tr.querySelectorAll("td").forEach(function (td) { row.push(td.textContent.trim()); });
      if (row.length) rows.push(row);
    });
    printHtml("تقرير صلاحية الدفعات — ميزان فارما", tableHtml(heads, rows));
  }
  function startRx () {
    RX = {
      active: true,
      patient: String(($("phRxPatient") || {}).value || "").trim(),
      doctor: String(($("phRxDoctor") || {}).value || "").trim(),
      no: String(($("phRxNo") || {}).value || "").trim(),
      date: String(($("phRxDate") || {}).value || today()),
      note: String(($("phRxNote") || {}).value || "").trim()
    };
    if (!RX.patient && !RX.no) { notify("اكتب اسم المريض أو رقم الوصفة أولًا.", "warning"); RX.active = false; renderRxStatus(); return; }
    renderRxStatus();
    notify("الوصفة مفعّلة — اضيف الأصناف في شاشة البيع زي ما تعمل دايمًا.", "success");
    if (A && typeof A.showView === "function") A.showView("sales");
  }
  function clearRxState () {
    RX = { active: false, patient: "", doctor: "", no: "", date: "", note: "" };
    ["phRxPatient", "phRxDoctor", "phRxNo", "phRxDate", "phRxNote"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    renderRxStatus();
  }
  function clearRx () {
    clearRxState();
    notify("تم إلغاء الوصفة.", "info");
  }

  /* 🔒 الخروج/تغيير الشركة: الوصفة المفعّلة والكاش ما ينتقلوش لحساب تاني.
     بنفضّ الكاش كمان عشان أي دخول تاني يسحب من Supabase قبل ما البيع يفتح. */
  function resetRx () {
    clearRxState();
    CACHE = null;
    hydrated = false;
  }
  /* الإقلاع بعد سحب السحابة: نفضّ الوصفة بس، من غير ما نلغي حالة التحميل اللي وصلت
     ( كان ON_BOOT_READY بينادي resetRx فتقفل بوابة البيع بعد ما البيانات نزلت فعلًا ). */
  function onBootReady () { clearRxState(); }
  function ready () {
    // الوضع المحلي (بدون سحابة) ما عندهوش مصدر إجباري؛ أما في وضع السحابة لازم
    // تكون الدفعات نزلت فعلًا قبل ما بوابة الوصفة/الصلاحية تسمح بالبيع.
    return !(A && A.online) || hydrated === true;
  }
  function hydrateFromCloud () {
    if (!A || typeof A.pharmaPull !== "function") return;
    var p = A.pharmaPull().then(function (ph) { pharmaHydrate(ph); }, function (e) { pharmaHydrate(null); });
    queueCloud(p, "hydrate");
  }

  /* ↩️ حذف/مرتجع الفاتورة: نرجّع الكمية اللي اتصرفت من الدفعات (بمعرفاتها)
     ونعلّم سجل الصرف إنه اترجّع، بدل ما الرصيد يكبر والدفعات تفضل ناقصة. */
  function restoreSale (payload) {
    var inv = (payload && payload.invoice) || {};
    var saleId = inv.id != null ? inv.id : (payload && payload.saleId != null ? payload.saleId : null);
    var invNo = inv.invoiceNumber || inv.invoiceNo || (payload && payload.invoiceNo) || "";
    var items = (payload && payload.items) || [];
    var wanted = {};
    items.forEach(function (it) {
      if (!it || it.productId == null) return;
      var k = String(it.productId);
      wanted[k] = num(num(wanted[k] || 0) + num(it.qty));
    });
    var partial = Object.keys(wanted).length > 0;
    var d = load();
    var changed = false;
    (d.dispenses || []).forEach(function (r) {
      var matchSale = saleId != null && r.saleId != null && String(r.saleId) === String(saleId);
      var matchNo = !!invNo && String(r.invoiceNo || "") === String(invNo);
      if ((!matchSale && !matchNo) || r.deleted === true) return;
      var rk = String(r.productId);
      if (partial && wanted[rk] == null) return;
      var need = partial ? num(wanted[rk]) : num(r.qty);
      var restored = 0;
      (r.batchRefs || []).forEach(function (ref) {
        if (need <= 0.00001) return;
        var pid = ref.productId != null ? ref.productId : r.productId;
        if (partial && String(pid) !== rk) return;
        var take = Math.min(need, num(ref.qty));
        if (take <= 0.00001) return;
        var p = findProduct(pid);
        var x = entry(pid, false);
        var b = null;
        for (var i = 0; i < x.r.batches.length; i++) {
          if (String(x.r.batches[i].id) === String(ref.id)) { b = x.r.batches[i]; break; }
        }
        if (!b) {
          b = { id: String(ref.id), no: ref.no || "", expiry: ref.expiry || "", qty: 0,
                cost: 0, warehouse: ref.warehouse || "", status: "active", stockAdded: false };
          x.r.batches.push(b);
        }
        b.qty = num(num(b.qty) + take);
        x.d.products[String(pid)] = x.r;
        queueCloud(cloudUpsert("pharma_batches", cloudBatchRow(b, p)), "batch restore");
        restored = num(restored + take);
        need = num(need - take);
      });
      if (restored <= 0.00001) return;
      if (partial) wanted[rk] = need;
      r.qty = num(Math.max(0, num(r.qty) - restored));
      var full = num(r.qty) <= 0.00001;
      if (full) r.deleted = true;
      else r.note = String(r.note || "") + " | رُجّع جزئيًا";
      changed = true;
      queueCloud(cloudUpsert("pharma_dispenses", cloudDispenseRow(r)), "dispense reverse");
    });
    if (!changed) return;
    save(d);
    renderBatches();
    renderDispenses();
    renderReports();
  }

  /* ↩️ حذف مرتجع: الرصيد اتخصم تاني في app.js — نخصم الدفعات كمان ونفعل سجل الصرف. */
  function reconsumeSale (payload) {
    var inv = (payload && payload.invoice) || {};
    var saleId = inv.id != null ? inv.id : (payload && payload.saleId != null ? payload.saleId : null);
    var invNo = inv.invoiceNumber || inv.invoiceNo || (payload && payload.invoiceNo) || "";
    var wh = (payload && payload.warehouse) || "";
    var d = load();
    var changed = false;
    (d.dispenses || []).forEach(function (r) {
      var matchSale = saleId != null && r.saleId != null && String(r.saleId) === String(saleId);
      var matchNo = !!invNo && String(r.invoiceNo || "") === String(invNo);
      if ((!matchSale && !matchNo) || r.deleted !== true) return;
      var refs = r.batchRefs || [];
      if (!refs.length) {
        var x0 = entry(r.productId, false);
        consumeBatches(x0.r.batches, r.qty, wh);
        x0.r.batches.forEach(function (b) {
          queueCloud(cloudUpsert("pharma_batches", cloudBatchRow(b, findProduct(r.productId))), "batch reconsume");
        });
      }
      refs.forEach(function (ref) {
        var pid = ref.productId != null ? ref.productId : r.productId;
        var x = entry(pid, false);
        for (var i = 0; i < x.r.batches.length; i++) {
          var b = x.r.batches[i];
          if (String(b.id) !== String(ref.id)) continue;
          b.qty = num(Math.max(0, num(b.qty) - num(ref.qty)));
          queueCloud(cloudUpsert("pharma_batches", cloudBatchRow(b, findProduct(pid))), "batch reconsume");
          break;
        }
      });
      r.deleted = false;
      changed = true;
      queueCloud(cloudUpsert("pharma_dispenses", cloudDispenseRow(r)), "dispense restore");
    });
    if (!changed) return;
    save(d);
    renderBatches();
    renderDispenses();
    renderReports();
  }

  function bind () {
    if (bound) return;
    bound = true;
    var b;
    b = $("phBatchSave"); if (b) b.addEventListener("click", saveBatch);
    b = $("phRxStart"); if (b) b.addEventListener("click", startRx);
    b = $("phRxClear"); if (b) b.addEventListener("click", clearRx);
    b = $("pharmaBtnRefresh"); if (b) b.addEventListener("click", function () { hydrateFromCloud(); openView(); });
    b = $("pharmaBtnPrint"); if (b) b.addEventListener("click", printReport);
    var bt = $("phBatchesTable");
    if (bt) bt.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      var tr = btn.closest("tr");
      if (!tr) return;
      if (btn.dataset.act === "del") deleteBatch(tr.dataset.pid, tr.dataset.bid);
      if (btn.dataset.act === "label") printBatchLabel(tr.dataset.pid, tr.dataset.bid);
    });
    var dt = $("phDispenseTable");
    if (dt) dt.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-act='rxlabel']");
      if (!btn) return;
      var tr = btn.closest("tr");
      if (tr) printDispenseLabel(tr.dataset.rid);
    });
    document.querySelectorAll(".pharma-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".pharma-tab").forEach(function (x) { x.classList.remove("active"); });
        tab.classList.add("active");
        var name = tab.dataset.tab;
        document.querySelectorAll(".pharma-panel").forEach(function (p) {
          p.hidden = p.dataset.panel !== name;
        });
      });
    });
  }

  /* ---------- الواجهة العامة المستخدمة من app.js ---------- */
  window.PHARMA = {
    attachApi: function (api) { A = api || A; bind(); },
    onBootReady: onBootReady,
    ready: ready,
    resetRx: resetRx,
    pharmaHydrate: pharmaHydrate,
    hydrateFromCloud: hydrateFromCloud,
    restoreSale: restoreSale,
    reconsumeSale: reconsumeSale,
    openView: openView,
    productDialogOpen: function (p) { fillMetaForm(p && p.product ? p.product : null); },
    productSaved: function (p) {
      var product = p && p.product;
      if (!product) return;
      var x = entry(product.id, true);
      x.r.meta = readMetaForm();
      save(x.d);
      queueCloud(cloudUpsert("pharma_product_meta", cloudMetaRow(x.r.meta, product)), "meta save");
    },
    stripsPerBox: function (productId) {
      return stripsCount((entry(productId, false).r.meta || {}).stripsPerBox);
    },
    stripPrice: function (productId, boxPrice) {
      var n = stripsCount((entry(productId, false).r.meta || {}).stripsPerBox);
      var p = Number(boxPrice) || 0;
      return n > 1 ? p / n : p;
    },
    validateSale: validateSale,
    posInvoiceSaved: posInvoiceSaved
  };
})();
