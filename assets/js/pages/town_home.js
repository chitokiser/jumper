// /assets/js/pages/town_home.js
// 우리마을 홈: 관리자 버튼 표시 + 공지(펼침/접기) + 사진관 슬라이더(안정형)

import { auth, db } from "/assets/js/auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

/* =====================
   0) 진단 로그(프로젝트 불일치 체크)
===================== */
try{
  console.log("[town_home] firebase projectId =", db?.app?.options?.projectId);
}catch(e){}

/* =====================
   1) 관리자 버튼 표시
===================== */
async function isAdmin(uid){
  if(!uid) return false;
  try{
    const ref = doc(db, "admins", uid);
    const snap = await getDoc(ref);
    return snap.exists();
  }catch(e){
    console.warn("isAdmin check failed:", e);
    return false;
  }
}

function setupAdminUI(admin){
  const btnAdminPlace = $("btnAdminPlace");
  const noticeAdminLink = $("noticeAdminLink");
  if(btnAdminPlace) btnAdminPlace.style.display = admin ? "" : "none";
  if(noticeAdminLink) noticeAdminLink.style.display = admin ? "" : "none";
}

/* =====================
   2) 공지사항(최신 n개)
===================== */
function makeNoticeRow(v){
  const li = document.createElement("li");
  li.className = "notice-row";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "notice-head";
  head.textContent = v.title || v.text || "(제목 없음)";

  const body = document.createElement("div");
  body.className = "notice-body";
  body.textContent = v.text || "";
  body.style.display = "none";

  head.onclick = () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
  };

  li.appendChild(head);
  li.appendChild(body);
  return li;
}

async function loadNotices(){
  const list = $("noticeList");
  if(!list) return;
  list.innerHTML = "";

  try{
    // 1차: createdAt desc 정렬(표준)
    const q1 = query(
      collection(db, "notices"),
      orderBy("createdAt", "desc"),
      limit(8)
    );

    const snap = await getDocs(q1);

    if(snap.empty){
      const li = document.createElement("li");
      li.textContent = "등록된 공지사항이 없습니다.";
      list.appendChild(li);
      return;
    }

    const docs = [];
    snap.forEach((d) => docs.push(d.data() || {}));

    docs.sort((a,b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if(ap !== bp) return bp - ap;
      const am = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
      const bm = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
      return bm - am;
    });

    docs.forEach((v) => {
      if(v.visible === false) return;
      list.appendChild(makeNoticeRow(v));
    });

    if(!list.children.length){
      const li = document.createElement("li");
      li.textContent = "표시할 공지사항이 없습니다.";
      list.appendChild(li);
    }
  }catch(e){
    // createdAt이 없는 문서가 섞이면 orderBy가 실패할 수 있습니다.
    // 2차: 정렬 없이 가져온 뒤 클라에서 정렬/필터합니다.
    console.warn("loadNotices primary query failed, fallback:", e);

    try{
      const q2 = query(collection(db, "notices"), limit(20));
      const snap2 = await getDocs(q2);

      const docs = [];
      snap2.forEach((d) => docs.push(d.data() || {}));

      docs
        .filter((v) => v.visible !== false)
        .sort((a,b) => {
          const ap = a.pinned ? 1 : 0;
          const bp = b.pinned ? 1 : 0;
          if(ap !== bp) return bp - ap;
          const am = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
          const bm = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
          return bm - am;
        })
        .slice(0, 8)
        .forEach((v) => list.appendChild(makeNoticeRow(v)));

      if(!list.children.length){
        const li = document.createElement("li");
        li.textContent = "표시할 공지사항이 없습니다.";
        list.appendChild(li);
      }
    }catch(e2){
      console.warn("loadNotices fallback failed:", e2);
      const li = document.createElement("li");
      li.textContent = "공지사항을 불러오지 못했습니다.";
      list.appendChild(li);
    }
  }
}

/* =====================
   3) 우리마을 사진관(안정형)
   - 1~UI_MAX 까지 존재하는 파일만 자동 수집
   - png/jpg/jpeg/webp 확장자까지 같이 체크
===================== */
// NOTE:
// - 파일명이 1.png, 2.png ... 처럼 “연속 번호”로 계속 늘어날 수 있으므로
//   상한(UI_MAX)을 넉넉히 잡고, 연속 미존재가 일정 횟수 누적되면 자동 종료합니다.
const UI_MAX  = 250; // 1~250까지 시도 (연속 누락 감지로 조기 종료)
const UI_BASE = "/assets/images/ui/";
const UI_EXTS = ["png", "jpg", "jpeg", "webp"];

// 슬라이더 프레임(배경 블러용)
const uiStage = document.querySelector("#uiSlider .ps-stage");

function setStageBg(src){
  if(!uiStage) return;
  // CSS에서 background-image: var(--ps-bg) 를 사용
  uiStage.style.setProperty("--ps-bg", `url(\"${src}\")`);
}

const uiPrev = $("uiPrev");
const uiNext = $("uiNext");
const uiImg  = $("uiSlideImg");
const uiIdx  = $("uiSlideIndex");
const uiHelp = $("uiSlideHelp");

let uiList = [];
let uiPos  = 0;
let uiBusy = false;

function preload(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 너무 오래 기다리면 초기 로딩이 답답해집니다.
    // 정상 파일은 보통 빠르게 로드되므로 타임아웃을 짧게 둡니다.
    const timer = setTimeout(() => reject(new Error("timeout")), 5000);
    img.onload = () => { clearTimeout(timer); resolve(src); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("error")); };
    img.src = src;
  });
}

function setHelp(msg){
  if(uiHelp) uiHelp.textContent = msg || "";
}

function setIndexLabel(){
  if(!uiIdx) return;
  if(uiList.length === 0) uiIdx.textContent = "-";
  else uiIdx.textContent = `${uiPos + 1} / ${uiList.length}`;
}

async function showAt(nextPos){
  if(!uiImg) return;

  if(uiList.length === 0){
    setHelp("표시할 사진이 없습니다. /assets/images/ui/ 경로를 확인해 주세요.");
    setIndexLabel();
    return;
  }

  if(uiBusy) return;
  uiBusy = true;

  const n = uiList.length;
  const pos = ((nextPos % n) + n) % n;
  const src = uiList[pos];

  try{
    await preload(src);
    uiPos = pos;
    uiImg.src = src;
    setStageBg(src);
    setIndexLabel();
    setHelp("");
  }catch(e){
    setHelp("일부 사진 로드 실패(파일 누락/경로 오류). 존재하는 사진만 표시 중입니다.");
    setIndexLabel();
  }finally{
    uiBusy = false;
  }
}

async function findFirstExisting(i){
  for(const ext of UI_EXTS){
    const src = `${UI_BASE}${i}.${ext}`;
    try{
      await preload(src);
      return src;
    }catch(e){
      // 다음 확장자 시도
    }
  }
  return null;
}

async function initUISlider(){
  if(!uiImg) return;

  uiImg.removeAttribute("src");
  uiImg.alt = "우리마을 사진";
  setHelp("사진을 불러오는 중입니다…");

  // 1~UI_MAX 범위에서 “실제로 존재하는 파일”만 수집
  // - 연속으로 파일이 없으면(END_GAP) “끝”으로 판단하고 중단
  const END_GAP = 8;
  let gap = 0;
  uiList = [];

  for(let i=1;i<=UI_MAX;i++){
    // 존재 체크(확장자 순회)
    const src = await findFirstExisting(i);
    if(src){
      uiList.push(src);
      gap = 0;
    }else{
      gap++;
      if(uiList.length > 0 && gap >= END_GAP) break;
    }
  }

  if(uiList.length === 0){
    setHelp("사진을 불러오지 못했습니다. /assets/images/ui/1.png 처럼 실제 파일이 있는지 확인해 주세요.");
    setIndexLabel();
    return;
  }

  uiPos = 0;
  uiImg.src = uiList[0];
  setStageBg(uiList[0]);
  setIndexLabel();
  setHelp(`${uiList.length}장의 사진을 표시합니다.`);

  if(uiPrev) uiPrev.onclick = () => showAt(uiPos - 1);
  if(uiNext) uiNext.onclick = () => showAt(uiPos + 1);

  // 키보드 좌우도 지원(원하면)
  window.addEventListener("keydown", (e) => {
    if(e.key === "ArrowLeft") showAt(uiPos - 1);
    if(e.key === "ArrowRight") showAt(uiPos + 1);
  });
}

/* =====================
   4) 부팅
===================== */
onAuthStateChanged(auth, async (user) => {
  const admin = await isAdmin(user?.uid);
  setupAdminUI(admin);
});

loadNotices();
initUISlider();
