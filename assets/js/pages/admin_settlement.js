// /assets/js/pages/admin_settlement.js
// 관리자 정산
// 핵심
// - orders.status: paid -> confirmed(관리자 결제확인) -> settled(월정산 락)
// - settlements/{yyyy-mm} 에 월 스냅샷 저장(locked=true)
// - settlements/{yyyy-mm}/guides/{guideUid} 에 가이드별 정산 + 지급상태 저장

import { onAuthReady } from "/assets/js/auth.js";
import { auth, db } from "/assets/js/firebase-init.js";
import { isAdmin } from "/assets/js/roles.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function $(id){ return document.getElementById(id); }

function money(v){
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR");
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function toYMDHMS(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    const ss = String(d.getSeconds()).padStart(2,"0");
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  }catch(e){
    return "";
  }
}

function initMonthDefault(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  $("month").value = `${y}-${m}`;
}

function guideNameFromDoc(g){
  return g.displayName || g.name || g.nickname || g.title || g.company || "";
}

function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

function exportCsv(){
  const ym = $("month").value || "";
  const rows = window.__SETTLEMENT_ROWS__ || [];
  const head = ["guideUid","guideName","orders","gross","fee","net","paidStatus","paidAt","paidMethod","paidRef"];
  const lines = [head.join(",")];
  for (const r of rows){
    lines.push(head.map(k=>csvEscape(r[k])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `settlement_${ym || "all"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function getSettlementDoc(ym){
  const ref = doc(db, "settlements", ym);
  const snap = await getDoc(ref);
  return { ref, snap, data: (snap.exists() ? (snap.data() || {}) : null) };
}

async function loadLockedSettlement(ym){
  const rowsEl = $("rows");
  rowsEl.innerHTML = "";

  const run = await getSettlementDoc(ym);
  if (!run.data || run.data.locked !== true) return null;

  $("lockState").textContent = "락됨: 월 정산 확정 완료";
  $("lockSub").textContent = `확정일 ${toYMDHMS(run.data.lockedAt)} / 커미션 ${Number(run.data.commissionPct || 0)}%`;

  $("commission").value = String(Number(run.data.commissionPct || 0));
  $("commission").disabled = true;

  $("kpiCount").textContent = String(run.data.totalOrders ?? "-");
  $("kpiGross").textContent = (run.data.totalGross != null) ? money(run.data.totalGross) : "-";
  $("kpiFee").textContent = (run.data.totalFee != null) ? money(run.data.totalFee) : "-";
  $("kpiNet").textContent = (run.data.totalNet != null) ? money(run.data.totalNet) : "-";

  const gcol = collection(db, "settlements", ym, "guides");
  const gsnap = await getDocs(gcol);

  const list = [];
  gsnap.forEach(s=> list.push({ id: s.id, ...(s.data() || {}) }));
  list.sort((a,b)=> Number(b.net||0) - Number(a.net||0));

  const csvRows = [];
  rowsEl.innerHTML = list.map((row)=>{
    const uid = String(row.guideUid || row.id || "");
    const short = uid ? (uid.slice(0,6)+"…"+uid.slice(-4)) : "";
    const gname = row.guideName || (short ? `가이드(${short})` : "(가이드)");

    const paid = String(row.paidStatus || "unpaid");
    const paidAt = row.paidAt ? toYMDHMS(row.paidAt) : "";

    const pillClass = (paid === "paid") ? "pay-pill pay-pill--paid" : "pay-pill pay-pill--unpaid";
    const pillText  = (paid === "paid") ? `지급완료${paidAt ? ` (${paidAt})` : ""}` : "지급대기";

    csvRows.push({
      guideUid: uid,
      guideName: gname,
      orders: row.orders || 0,
      gross: row.gross || 0,
      fee: row.fee || 0,
      net: row.net || 0,
      paidStatus: paid,
      paidAt: paidAt,
      paidMethod: row.paidMethod || "",
      paidRef: row.paidRef || "",
    });

    return `
      <div class="tr">
        <div class="td">
          <div class="guide-cell">
            <div class="guide-name">${escapeHtml(gname)}</div>
            <div class="guide-sub">${escapeHtml(uid)}</div>
          </div>
        </div>
        <div class="td right">${escapeHtml(String(row.orders || 0))}</div>
        <div class="td right">${escapeHtml(money(row.gross || 0))}</div>
        <div class="td right">${escapeHtml(money(row.fee || 0))}</div>
        <div class="td right">${escapeHtml(money(row.net || 0))}</div>
        <div class="td"><span class="${pillClass}">${escapeHtml(pillText)}</span></div>
        <div class="td right">
          <div class="actions">
            <button class="btn btn--sm btn--ghost" data-act="pay" data-uid="${escapeHtml(uid)}">지급</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  window.__SETTLEMENT_ROWS__ = csvRows;
  bindRowActions(ym);
  return { run: run.data, list };
}

async function loadPreview(profile){
  const state = $("state");
  const rowsEl = $("rows");
  rowsEl.innerHTML = "";
  state.textContent = "로딩중…";

  const user = auth.currentUser;
  if (!user){
    state.textContent = "로그인 후 이용 가능합니다.";
    ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="-");
    $("lockState").textContent = "-";
    $("lockSub").textContent = "";
    return;
  }

  if (!isAdmin(profile)){
    state.textContent = "관리자만 접근 가능합니다.";
    ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="-");
    $("lockState").textContent = "-";
    $("lockSub").textContent = "";
    return;
  }

  const ym = $("month").value;

  // 1) 락이 있으면 락 데이터로 표시
  $("commission").disabled = false;
  const locked = await loadLockedSettlement(ym);
  if (locked){
    state.textContent = "정상 (락 데이터)";
    return;
  }

  // 2) 미락: 미리보기
  $("lockState").textContent = "미락: 아직 정산 확정되지 않음";
  $("lockSub").textContent = "정산 확정(락)을 누르면 해당 월 정산이 스냅샷으로 저장되고, 해당 월 주문은 정산완료로 처리됩니다.";

  const commissionPct = Math.max(0, Math.min(100, Number($("commission").value || 0)));
  const commissionRate = commissionPct / 100;

  try{
    const col = collection(db, "orders");
    // 인덱스 최소화: settlementMonth 단일 where만 사용
    const snap = await getDocs(query(col, where("settlementMonth", "==", ym)));

    const byGuide = new Map();
    let totalOrders = 0;
    let totalGross = 0;

    snap.forEach(docSnap=>{
      const o = docSnap.data() || {};
      if (String(o.status || "").toLowerCase() !== "confirmed") return;
      const guideUid = String(o.guideUid || o.ownerUid || "").trim();
      if (!guideUid) return;

      const total = Number(o.total || o.amount || 0);
      const amt = Number.isFinite(total) ? total : 0;

      totalOrders += 1;
      totalGross += amt;

      const cur = byGuide.get(guideUid) || { guideUid, orders: 0, gross: 0 };
      cur.orders += 1;
      cur.gross += amt;
      byGuide.set(guideUid, cur);
    });

    const list = Array.from(byGuide.values()).map(x=>{
      const fee = Math.round(x.gross * commissionRate);
      const net = x.gross - fee;
      return { ...x, fee, net };
    }).sort((a,b)=> b.net - a.net);

    const totalFee = Math.round(totalGross * commissionRate);
    const totalNet = totalGross - totalFee;

    $("kpiCount").textContent = String(totalOrders);
    $("kpiGross").textContent = money(totalGross);
    $("kpiFee").textContent = money(totalFee);
    $("kpiNet").textContent = money(totalNet);

    if (list.length === 0){
      state.textContent = "정산 대상 주문이 없습니다. (해당 월 orders.status=confirmed 확인)";
      window.__SETTLEMENT_ROWS__ = [];
      return;
    }
    state.textContent = "정상 (미락 미리보기)";

    const rows = [];
    const csvRows = [];

    for (const row of list){
      let gname = "";
      try{
        const gs = await getDoc(doc(db, "guides", row.guideUid));
        if (gs.exists()) gname = guideNameFromDoc(gs.data());
      }catch(e){}

      const short = row.guideUid.slice(0,6) + "…" + row.guideUid.slice(-4);
      const name = gname || `가이드(${short})`;

      rows.push(`
        <div class="tr">
          <div class="td">
            <div class="guide-cell">
              <div class="guide-name">${escapeHtml(name)}</div>
              <div class="guide-sub">${escapeHtml(row.guideUid)}</div>
            </div>
          </div>
          <div class="td right">${escapeHtml(String(row.orders))}</div>
          <div class="td right">${escapeHtml(money(row.gross))}</div>
          <div class="td right">${escapeHtml(money(row.fee))}</div>
          <div class="td right">${escapeHtml(money(row.net))}</div>
          <div class="td"><span class="pay-pill pay-pill--unpaid">미락</span></div>
          <div class="td right"><div class="actions"></div></div>
        </div>
      `);

      csvRows.push({
        guideUid: row.guideUid,
        guideName: name,
        orders: row.orders,
        gross: row.gross,
        fee: row.fee,
        net: row.net,
        paidStatus: "",
        paidAt: "",
        paidMethod: "",
        paidRef: "",
      });
    }

    rowsEl.innerHTML = rows.join("");
    window.__SETTLEMENT_ROWS__ = csvRows;

  }catch(err){
    console.error(err);
    state.textContent = "정산 데이터를 불러오지 못했습니다. (rules 또는 settlementMonth/createdAt 확인)";
    window.__SETTLEMENT_ROWS__ = [];
  }
}

async function lockSettlement(profile){
  const user = auth.currentUser;
  if (!user || !isAdmin(profile)) return;

  const ym = $("month").value;
  if (!ym){
    alert("정산 월을 선택해 주세요.");
    return;
  }

  const run = await getSettlementDoc(ym);
  if (run.data && run.data.locked === true){
    alert("이미 락된 월입니다.");
    return;
  }

  const commissionPct = Math.max(0, Math.min(100, Number($("commission").value || 0)));
  const commissionRate = commissionPct / 100;

  const state = $("state");
  state.textContent = "락 생성중…";

  try{
    const col = collection(db, "orders");
    const snap = await getDocs(query(col, where("settlementMonth", "==", ym)));

    const byGuide = new Map();
    const orderIdsToSettle = [];

    let totalOrders = 0;
    let totalGross = 0;

    snap.forEach(docSnap=>{
      const o = docSnap.data() || {};
      if (String(o.status || "").toLowerCase() !== "confirmed") return;

      const guideUid = String(o.guideUid || o.ownerUid || "").trim();
      if (!guideUid) return;

      const total = Number(o.total || o.amount || 0);
      const amt = Number.isFinite(total) ? total : 0;

      totalOrders += 1;
      totalGross += amt;
      orderIdsToSettle.push(docSnap.id);

      const cur = byGuide.get(guideUid) || { guideUid, orders: 0, gross: 0, orderLines: [] };
      cur.orders += 1;
      cur.gross += amt;

      // audit 라인 (문서 크기 보호)
      if (cur.orderLines.length < 200){
        cur.orderLines.push({
          id: docSnap.id,
          title: String(o.itemTitle || "(상품)"),
          total: amt,
          status: "confirmed",
        });
      }

      byGuide.set(guideUid, cur);
    });

    if (totalOrders === 0){
      state.textContent = "락 생성 실패: 해당 월 confirmed 주문이 없습니다.";
      return;
    }

    const guides = Array.from(byGuide.values()).map(g=>{
      const fee = Math.round(g.gross * commissionRate);
      const net = g.gross - fee;
      return { ...g, fee, net };
    });

    const totalFee = Math.round(totalGross * commissionRate);
    const totalNet = totalGross - totalFee;

    // guideName resolve
    for (const g of guides){
      let gname = "";
      try{
        const gs = await getDoc(doc(db, "guides", g.guideUid));
        if (gs.exists()) gname = guideNameFromDoc(gs.data());
      }catch(e){}
      g.guideName = gname;
    }

    // ops (set: settlements, set: per-guide, update: orders)
    const ops = [];

    ops.push({
      type: "set",
      ref: doc(db, "settlements", ym),
      data: {
        ym,
        locked: true,
        commissionPct,
        lockedAt: serverTimestamp(),
        lockedBy: user.uid,
        totalOrders,
        totalGross,
        totalFee,
        totalNet,
      },
    });

    for (const g of guides){
      ops.push({
        type: "set",
        ref: doc(db, "settlements", ym, "guides", g.guideUid),
        data: {
          ym,
          guideUid: g.guideUid,
          guideName: g.guideName || "",
          orders: g.orders,
          gross: g.gross,
          fee: g.fee,
          net: g.net,
          orderLines: g.orderLines || [],
          paidStatus: "unpaid",
          paidAt: null,
          paidBy: "",
          paidMethod: "",
          paidRef: "",
          createdAt: serverTimestamp(),
        },
      });
    }

    for (const oid of orderIdsToSettle){
      ops.push({
        type: "update",
        ref: doc(db, "orders", oid),
        data: {
          status: "settled",
          settledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      });
    }

    // commit in batches (500ops limit, 여유 있게 430)
    let i = 0;
    while (i < ops.length){
      const batch = writeBatch(db);
      let count = 0;
      while (i < ops.length && count < 430){
        const op = ops[i++];
        if (op.type === "set") batch.set(op.ref, op.data);
        if (op.type === "update") batch.update(op.ref, op.data);
        count++;
      }
      await batch.commit();
    }

    state.textContent = "락 생성 완료";
    await loadPreview(profile);

  }catch(err){
    console.error(err);
    state.textContent = "락 생성 실패: rules/필드(settlementMonth/status) 확인";
  }
}

function bindRowActions(ym){
  const dlg = $("dlgPay");
  const btnSave = $("btnPaySave");

  if (window.__PAY_BOUND__) return;
  window.__PAY_BOUND__ = true;

  document.addEventListener("click", (e)=>{
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t?.dataset?.act !== "pay") return;
    const uid = t.dataset.uid || "";
    if (!uid) return;

    $("payGuideUid").value = uid;
    $("payMethod").value = "bank";
    $("payRef").value = "";
    dlg.showModal();
  });

  btnSave.addEventListener("click", async (e)=>{
    e.preventDefault();
    const guideUid = $("payGuideUid").value;
    const method = $("payMethod").value || "";
    const ref = $("payRef").value || "";
    if (!guideUid) return;

    const user = auth.currentUser;
    if (!user) return;

    try{
      const currentYm = $("month").value;
      await updateDoc(doc(db, "settlements", currentYm, "guides", guideUid), {
        paidStatus: "paid",
        paidAt: serverTimestamp(),
        paidBy: user.uid,
        paidMethod: method,
        paidRef: ref,
      });
      dlg.close();
      await loadPreview(window.__CURRENT_PROFILE__);
    }catch(err){
      console.error(err);
      alert("지급 처리 실패: rules 확인");
    }
  });
}

onAuthReady(async ({ loggedIn, profile })=>{
  window.__CURRENT_PROFILE__ = profile;

  initMonthDefault();

  $("btnReload").addEventListener("click", ()=>loadPreview(profile));
  $("btnCsv").addEventListener("click", exportCsv);
  $("month").addEventListener("change", ()=>loadPreview(profile));
  $("commission").addEventListener("change", ()=>loadPreview(profile));
  $("btnLock").addEventListener("click", ()=>lockSettlement(profile));

  if (!loggedIn){
    await loadPreview(null);
    return;
  }
  await loadPreview(profile);
});
