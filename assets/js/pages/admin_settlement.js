// /assets/js/pages/admin_settlement.js
// 관리자용 가맹점 매출 현황
// - orders.status: confirmed | paid | settled 주문을 가맹점(guideUid/ownerUid)별로 집계
// - settlements 컬렉션 불사용 (락 기능 제거)

import { onAuthStateChanged, getUserProfile, auth, db } from "/assets/js/auth.js";
import { isAdmin } from "/assets/js/roles.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const SETTLED_STATUSES = new Set(["confirmed", "paid", "settled", "completed"]);

function $(id){ return document.getElementById(id); }

function money(v){
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR");
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function initMonthDefault(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  $("month").value = `${y}-${m}`;
}

function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

function exportCsv(){
  const ym = $("month").value || "";
  const rows = window.__SETTLEMENT_ROWS__ || [];
  const head = ["merchantUid","merchantName","orders","gross","fee","net"];
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

function merchantName(data, uid){
  if (!data) return "";
  return data.displayName || data.name || data.nickname || data.title || data.company || "";
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
    return;
  }

  if (!isAdmin(profile)){
    state.textContent = "관리자만 접근 가능합니다.";
    ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="-");
    return;
  }

  const ym = $("month").value;
  if (!ym){
    state.textContent = "정산 월을 선택해 주세요.";
    return;
  }

  const commissionPct = Math.max(0, Math.min(100, Number($("commission").value || 0)));
  const commissionRate = commissionPct / 100;

  try{
    const snap = await getDocs(
      query(collection(db, "orders"), where("settlementMonth", "==", ym))
    );

    const byMerchant = new Map();
    let totalOrders = 0;
    let totalGross = 0;

    snap.forEach(docSnap=>{
      const o = docSnap.data() || {};
      const status = String(o.status || "").toLowerCase();
      if (!SETTLED_STATUSES.has(status)) return;

      const uid = String(o.guideUid || o.ownerUid || "").trim();
      if (!uid) return;

      const amt = Number.isFinite(Number(o.total || o.amount || 0))
        ? Number(o.total || o.amount || 0)
        : 0;

      totalOrders += 1;
      totalGross += amt;

      const cur = byMerchant.get(uid) || { uid, orders: 0, gross: 0 };
      cur.orders += 1;
      cur.gross += amt;
      byMerchant.set(uid, cur);
    });

    if (byMerchant.size === 0){
      ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="0");
      state.textContent = "해당 월 매출 데이터가 없습니다.";
      window.__SETTLEMENT_ROWS__ = [];
      return;
    }

    const totalFee = Math.round(totalGross * commissionRate);
    const totalNet = totalGross - totalFee;

    $("kpiCount").textContent = String(totalOrders);
    $("kpiGross").textContent = money(totalGross);
    $("kpiFee").textContent = money(totalFee);
    $("kpiNet").textContent = money(totalNet);

    // 가맹점 이름 조회 후 렌더링
    const list = Array.from(byMerchant.values());
    list.sort((a,b)=> b.gross - a.gross);

    const htmlRows = [];
    const csvRows = [];

    for (const row of list){
      const fee = Math.round(row.gross * commissionRate);
      const net = row.gross - fee;

      let mname = "";
      try{
        const gs = await getDoc(doc(db, "guides", row.uid));
        if (gs.exists()) mname = merchantName(gs.data(), row.uid);
      }catch(e){}

      const short = row.uid.slice(0,6) + "…" + row.uid.slice(-4);
      const displayName = mname || `가맹점(${short})`;

      htmlRows.push(`
        <div class="tr">
          <div class="td">
            <div class="guide-cell">
              <div class="guide-name">${esc(displayName)}</div>
              <div class="guide-sub">${esc(row.uid)}</div>
            </div>
          </div>
          <div class="td right">${esc(String(row.orders))}</div>
          <div class="td right">${esc(money(row.gross))}</div>
          <div class="td right">${esc(money(fee))}</div>
          <div class="td right">${esc(money(net))}</div>
        </div>
      `);

      csvRows.push({
        merchantUid: row.uid,
        merchantName: displayName,
        orders: row.orders,
        gross: row.gross,
        fee,
        net,
      });
    }

    rowsEl.innerHTML = htmlRows.join("");
    window.__SETTLEMENT_ROWS__ = csvRows;
    state.textContent = `${byMerchant.size}개 가맹점 · 수수료 ${commissionPct}%`;

  }catch(err){
    console.error(err);
    state.textContent = "데이터를 불러오지 못했습니다. (Firestore rules 또는 settlementMonth 필드 확인)";
    window.__SETTLEMENT_ROWS__ = [];
  }
}

// 월 선택기는 즉시 초기화 (인증 대기 없이)
initMonthDefault();

let _unsub = null;
_unsub = onAuthStateChanged(auth, async (user) => {
  if (_unsub) { _unsub(); _unsub = null; }   // 최초 1회만

  const profile = user ? await getUserProfile(user) : null;

  $("btnReload").addEventListener("click", ()=>loadPreview(profile));
  $("btnCsv").addEventListener("click", exportCsv);
  $("month").addEventListener("change", ()=>loadPreview(profile));
  $("commission").addEventListener("change", ()=>loadPreview(profile));

  await loadPreview(profile);
});
