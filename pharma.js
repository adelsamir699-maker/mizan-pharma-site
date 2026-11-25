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
  var RX = { active: false, patient: "", doctor: "", no: "", date: "", note: "" };

  var META_FIELDS = {
    fPActiveIngredient: "activeIngredient",
    fPManufacturer: "manufacturer",
    fPRegistration: "registrationNo",
    fPForm: "form",
    fPStrength: "strength",
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
  function load () {
    try {
      var d = JSON.parse(localStorage.getItem(storeKey()) || "null");
      if (!d || typeof d !== "object") return blank();
      d.products = d.products && typeof d.products === "object" ? d.products : {};
      d.dispenses = Array.isArray(d.dispenses) ? d.dispenses : [];
      return d;
    } catch (e) { return blank(); }
  }
  function save (d) {
    try { localStorage.setItem(storeKey(), JSON.stringify(d || blank())); } catch (e) { }
  }
  function entry (productId, create) {
    var d = load();
    var k = String(productId);
    if (!d.products[k] && create) d.products[k] = { meta: {}, batches: [] };
    var r = d.products[k] || { meta: {}, batches: [] };
    r.meta = r.meta && typeof r.meta === "object" ? r.meta : {};
    r.batches = Array.isArray(r.batches) ? r.batches : [];
    return { d: d, k: k, r: r };
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
      if (el) el.value = m[META_FIELDS[id]] || "";
    });
    var rx = $("fPRx");
    if (rx) rx.value = m.rxRequired ? "1" : "0";
  }
  function readMetaForm () {
    var m = {};
    Object.keys(META_FIELDS).forEach(function (id) {
      var el = $(id);
      if (el) m[META_FIELDS[id]] = String(el.value || "").trim();
    });
    var rx = $("fPRx");
    m.rxRequired = !!(rx && rx.value === "1");
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
  function consumeBatches (batches, qty, wh) {
    var left = num(qty);
    var lines = [];
    var firstExpiry = "";
    var list = sortedBatches(liveBatches(batches, wh));
    for (var i = 0; i < list.length && left > 0.00001; i++) {
      var b = list[i];
      var take = Math.min(left, num(b.qty));
      b.qty = num(num(b.qty) - take);
      left = num(left - take);
      lines.push(String(b.no || "—") + " (" + (b.expiry || "—") + ") × " + money(take));
      if (!firstExpiry) firstExpiry = b.expiry || "";
    }
    return { lines: lines, firstExpiry: firstExpiry, ok: left <= 0.00001 };
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
      var meta = x.r.meta || {};
      var name = p.nameAr || p.code || "صنف";
      if (meta.rxRequired && !RX.active) {
        return "الصنف («" + name + "») لا يُصرف إلا بوصفة — افتح «💊 إدارة الصيدلية» ← «الصرف بوصفة» وسجّل الوصفة أولًا.";
      }
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
      d.products[String(p.id)] = x;
      recs.push({
        id: "d" + Date.now() + "-" + i,
        date: inv.invoiceDate || inv.date || today(),
        invoiceNo: inv.invoiceNumber || inv.invoiceNo || "",
        productId: p.id,
        code: it.code || p.code || "",
        nameAr: it.nameAr || p.nameAr || "",
        qty: num(it.qty),
        batchNo: alloc.lines.length ? alloc.lines.join(" | ") : "بدون دفعة مسجّلة",
        expiry: alloc.firstExpiry || "",
        patient: RX.active ? RX.patient : "",
        doctor: RX.active ? RX.doctor : "",
        rxNo: RX.active ? RX.no : "",
        note: RX.active ? RX.note : ""
      });
    }
    if (!recs.length) return;
    d.dispenses = recs.concat(d.dispenses || []).slice(0, 4000);
    save(d);
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
    body.innerHTML = "";
    var rows = [];
    products().forEach(function (p) {
      var x = entry(p.id, false).r;
      (x.batches || []).forEach(function (b) {
        rows.push({ p: p, b: b });
      });
    });
    rows = sortedBatches(rows.map(function (r) { return r.b; })).map(function (b) {
      for (var i = 0; i < rows.length; i++) if (rows[i].b === b) return rows[i];
      return null;
    }).filter(Boolean);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="invq-empty">مافيش دفعات مسجّلة لسه — سجّل أول دفعة من النموذج فوق.</td></tr>';
      return;
    }
    rows.forEach(function (row) {
      var p = row.p, b = row.b;
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + h(p.nameAr || p.code) + "</td>" +
        "<td>" + h(b.no) + "</td>" +
        "<td>" + h(b.expiry || "—") + "</td>" +
        "<td>" + money(b.qty) + "</td>" +
        "<td>" + h(b.warehouse || "—") + "</td>" +
        "<td>" + badge(b) + "</td>" +
        '<td><button class="btn small teal" type="button" data-act="label">🏷️ ملصق</button> ' +
        '<button class="btn small red" type="button" data-act="del">🗑️ حذف</button></td>';
      tr.dataset.pid = String(p.id);
      tr.dataset.bid = String(b.id);
      body.appendChild(tr);
    });
  }
  function renderDispenses () {
    var tb = $("phDispenseTable");
    if (!tb) return;
    var body = tb.querySelector("tbody");
    var d = load();
    var rows = (d.dispenses || []).slice(0, 400);
    body.innerHTML = "";
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="invq-empty">مافيش عمليات صرف مسجّلة لسه.</td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + h(r.date) + "</td>" +
        "<td>" + h(r.patient || "—") + "</td>" +
        "<td>" + h(r.nameAr || r.code) + "</td>" +
        "<td>" + money(r.qty) + "</td>" +
        "<td>" + h(r.batchNo) + "</td>" +
        "<td>" + h(r.invoiceNo) + "</td>" +
        '<td><button class="btn small teal" type="button" data-act="rxlabel">🏷️ ملصق</button></td>';
      tr.dataset.rid = String(r.id);
      body.appendChild(tr);
    });
  }
  function renderReports () {
    var k = $("phReportsKpis");
    var tb = $("phExpiryTable");
    if (!k || !tb) return;
    var d = load();
    var all = [];
    products().forEach(function (p) {
      var x = entry(p.id, false).r;
      (x.batches || []).forEach(function (b) { all.push({ p: p, b: b }); });
    });
    var exp = all.filter(function (r) { return daysLeft(r.b.expiry) < 0; });
    var soon = all.filter(function (r) { var n = daysLeft(r.b.expiry); return n >= 0 && n <= 30; });
    var todayCount = (d.dispenses || []).filter(function (r) { return String(r.date) === today(); }).length;
    k.innerHTML =
      '<div class="pharma-kpi"><b>' + all.length + "</b><span>دفعات مسجّلة</span></div>" +
      '<div class="pharma-kpi"><b>' + soon.length + "</b><span>تنتهي خلال 30 يوم</span></div>" +
      '<div class="pharma-kpi"><b>' + exp.length + "</b><span>دفعات منتهية</span></div>" +
      '<div class="pharma-kpi"><b>' + todayCount + "</b><span>عمليات صرف اليوم</span></div>";
    var body = tb.querySelector("tbody");
    var rows = sortedBatches(all.map(function (r) { return r.b; })).map(function (b) {
      for (var i = 0; i < all.length; i++) if (all[i].b === b) return all[i];
      return null;
    }).filter(Boolean);
    body.innerHTML = "";
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="invq-empty">مافيش دفعات لتقرير الصلاحية.</td></tr>';
      return;
    }
    rows.forEach(function (r) {
      var days = daysLeft(r.b.expiry);
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + h(r.p.nameAr || r.p.code) + "</td>" +
        "<td>" + h(r.b.no) + "</td>" +
        "<td>" + h(r.b.expiry || "—") + "</td>" +
        "<td>" + money(r.b.qty) + "</td>" +
        "<td>" + (days >= 99999 ? "—" : days) + "</td>" +
        "<td>" + badge(r.b) + "</td>";
      body.appendChild(tr);
    });
  }
  function renderRxStatus () {
    var el = $("phRxStatus");
    if (!el) return;
    if (!RX.active) {
      el.textContent = "حاليًا مفيش وصفة مفعّلة — أدخل البيانات واضغط «فتح شاشة البيع بالوصفة».";
      return;
    }
    el.textContent = "✅ وصفة مفعّلة: " + (RX.patient || "بدون اسم مريض") +
      " — الطبيب: " + (RX.doctor || "—") + " — رقم الوصفة: " + (RX.no || "—") +
      " — هتُسجّل تلقائيًا مع أول فاتورة بيع.";
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
    x.r.batches.push({
      id: "b" + Date.now() + "-" + Math.floor(Math.random() * 10000),
      no: no, expiry: exp, qty: qty, cost: cost, warehouse: wh,
      status: "active", addedAt: new Date().toISOString()
    });
    save(x.d);
    var addStock = $("phBatchAddStock");
    if (addStock && addStock.checked && A) {
      try { A.addStockAt(p, wh, qty); A.saveProducts(); } catch (e) { }
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
    if (!confirm("هل تحذف الدفعة «" + b.no + "»؟" + (num(b.qty) > 0 ? "\nالكمية المتبقية (" + money(b.qty) + ") هتخصم من رصيد المخزون." : ""))) return;
    x.r.batches.splice(idx, 1);
    save(x.d);
    if (num(b.qty) > 0 && A) {
      try { A.addStockAt(findProduct(pid), b.warehouse, -num(b.qty)); A.saveProducts(); } catch (e) { }
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
  function clearRx () {
    RX = { active: false, patient: "", doctor: "", no: "", date: "", note: "" };
    ["phRxPatient", "phRxDoctor", "phRxNo", "phRxNote"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    renderRxStatus();
    notify("تم إلغاء الوصفة.", "info");
  }

  function bind () {
    if (bound) return;
    bound = true;
    var b;
    b = $("phBatchSave"); if (b) b.addEventListener("click", saveBatch);
    b = $("phRxStart"); if (b) b.addEventListener("click", startRx);
    b = $("phRxClear"); if (b) b.addEventListener("click", clearRx);
    b = $("pharmaBtnRefresh"); if (b) b.addEventListener("click", openView);
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
    onBootReady: function () { },
    openView: openView,
    productDialogOpen: function (p) { fillMetaForm(p && p.product ? p.product : null); },
    productSaved: function (p) {
      var product = p && p.product;
      if (!product) return;
      var x = entry(product.id, true);
      x.r.meta = readMetaForm();
      save(x.d);
    },
    validateSale: validateSale,
    posInvoiceSaved: posInvoiceSaved
  };
})();
