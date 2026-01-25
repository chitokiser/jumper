// /assets/js/pages/guide_settlement.js
// 가이드 정산
// - 미락: orders에서 해당 월( settlementMonth ) confirmed 주문으로 미리보기
// - 락: settlements/{ym} + settlements/{ym}/guides/{uid} 스냅샷 표시

import { onAuthReady } from "/assets/js/auth.js";
import { auth, db } from "/assets/js/firebase-init.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

function toYMDHMS(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }catch(e){
    return "";
  }
}

function renderRows(rows){
  const rowsEl = $("rows");
  rowsEl.innerHTML = rows.map(r=>{
    return `
      <div class="tr">
        <div class="td">${esc(r.date || "-")}</div>
        <div class="td">${esc(r.title || "(상품)")}</div>
        <div class="td"><span class="badge">${esc(r.status || "-")}</span></div>
        <div class="td right">${esc(money(r.total || 0))}</div>
      </div>
    `;
  }).join("");
}

async function loadLocked(ym, uid){
  const runRef = doc(db, "settlements", ym);
  const runSnap = await getDoc(runRef);
  const run = runSnap.exists() ? (runSnap.data() || {}) : null;
  if (!run || run.locked !== true) return null;

  $("lockState").textContent = "락됨: 정산 확정 완료";
  $("lockSub").textContent = `확정일 ${toYMDHMS(run.lockedAt)} / 커미션 ${Number(run.commissionPct||0)}%`;

  $("commission").value = String(Number(run.commissionPct || 0));
  $("commission").disabled = true;

  const gref = doc(db, "settlements", ym, "guides", uid);
  const gs = await getDoc(gref);
  if (!gs.exists()) return { run, guide: null };
  return { run, guide: (gs.data() || {}) };
}

async function loadPreview(){
  const state = $("state");
  const user = auth.currentUser;

  if (!user){
    state.textContent = "로그인 후 이용 가능합니다.";
    renderRows([]);
    ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="-");
    $("lockState").textContent = "-";
    $("lockSub").textContent = "";
    return;
  }

  const ym = $("month").value;

  // 락 우선
  $("commission").disabled = false;
  const locked = await loadLocked(ym, user.uid);
  if (locked){
    if (!locked.guide){
      state.textContent = "해당 월 정산 대상 주문이 없습니다.";
      renderRows([]);
      ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="0");
      return;
    }

    const paid = String(locked.guide.paidStatus || "unpaid");
    const paidAt = locked.guide.paidAt ? toYMDHMS(locked.guide.paidAt) : "";
    const paidText = (paid === "paid") ? `지급완료${paidAt ? ` (${paidAt})` : ""}` : "지급대기";

    state.textContent = `정산 확정본 표시중 / ${paidText}`;

    $("kpiCount").textContent = String(locked.guide.orders || 0);
    $("kpiGross").textContent = money(locked.guide.gross || 0);
    $("kpiFee").textContent = money(locked.guide.fee || 0);
    $("kpiNet").textContent = money(locked.guide.net || 0);

    const lines = Array.isArray(locked.guide.orderLines) ? locked.guide.orderLines : [];
    const rows = lines.map(l=>({
      date: "-",
      title: l.title || "(상품)",
      status: l.status || "-",
      total: l.total || 0,
    }));
    renderRows(rows);
    return;
  }

  // 미락 미리보기
  $("lockState").textContent = "미락: 아직 정산 확정되지 않음";
  $("lockSub").textContent = "관리자가 정산 확정(락)하면 이 화면은 확정 정산 스냅샷으로 고정됩니다.";

  const commissionPct = Math.max(0, Math.min(100, Number($("commission").value || 0)));
  const commissionRate = commissionPct / 100;

  state.textContent = "로딩중…";

  try{
    // 인덱스 회피: 가이드 미러(guideOrders)에서 읽고 클라이언트 필터
    const col = collection(db, "guideOrders", user.uid, "orders");
    const snap = await getDocs(query(col));

    const rows = [];
    let totalOrders = 0;
    let totalGross = 0;

    snap.forEach(s=>{
      const o = s.data() || {};
      if (String(o.settlementMonth || "") !== ym) return;
      if (String(o.status || "").toLowerCase() !== "confirmed") return;

      const total = Number(o.total || o.amount || 0);
      const amt = Number.isFinite(total) ? total : 0;
      totalOrders += 1;
      totalGross += amt;

      const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      const ymd = d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "-";

      rows.push({
        date: ymd,
        title: String(o.itemTitle || "(상품)"),
        status: "confirmed",
        total: amt,
      });
    });

    rows.sort((a,b)=> String(b.date).localeCompare(String(a.date)));

    const fee = Math.round(totalGross * commissionRate);
    const net = totalGross - fee;

    $("kpiCount").textContent = String(totalOrders);
    $("kpiGross").textContent = money(totalGross);
    $("kpiFee").textContent = money(fee);
    $("kpiNet").textContent = money(net);

    renderRows(rows);
    state.textContent = "정상 (미락 미리보기)";

  }catch(err){
    console.error(err);
    state.textContent = "정산 데이터를 불러오지 못했습니다. (rules/인덱스 확인)";
    renderRows([]);
    ["kpiCount","kpiGross","kpiFee","kpiNet"].forEach(id=>$(id).textContent="-");
  }
}

onAuthReady(async ()=>{
  initMonthDefault();

  $("btnReload").addEventListener("click", loadPreview);
  $("month").addEventListener("change", loadPreview);
  $("commission").addEventListener("change", loadPreview);

  await loadPreview();
});
