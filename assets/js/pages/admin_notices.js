// /assets/js/pages/admin_notices.js
// 공지관리: 관리자만 작성/수정/삭제 가능

import { auth, db } from "/assets/js/auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const OPERATOR_EMAILS = new Set(["daguri75@gmail.com"]);

let _isAdmin = false;
let _currentUser = null;
let _editId = null; // 수정 중인 공지 ID

try{
  console.log("[admin_notices] firebase projectId =", db?.app?.options?.projectId);
}catch(e){}

function setState(msg){
  const el = $("anState");
  if(el) el.textContent = msg || "";
}

function setHelp(msg, warn=false){
  const el = $("anHelp");
  if(!el) return;
  el.textContent = msg || "";
  el.style.opacity = warn ? "1" : ".85";
}

function setFormEnabled(enabled){
  const form = $("noticeForm");
  if(!form) return;
  const fields = form.querySelectorAll("input,textarea,select,button");
  fields.forEach((f) => {
    if(f.id === "btnReset") return;
    f.disabled = !enabled;
  });
}

async function isAdmin(uid, email){
  const em = String(email || "").toLowerCase().trim();
  if(em && OPERATOR_EMAILS.has(em)) return true;

  if(!uid) return false;
  try{
    const ref = doc(db, "admins", uid);
    const snap = await getDoc(ref);
    return snap.exists();
  }catch(e){
    console.warn("isAdmin failed:", e);
    return false;
  }
}

function sanitize(s){
  return String(s ?? "").trim();
}

function badge(text){
  const span = document.createElement("span");
  span.className = "an-badge";
  span.textContent = text;
  return span;
}

function toMillis(ts){
  if(!ts) return 0;
  if(typeof ts?.toMillis === "function") return ts.toMillis();
  if(typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

// ── 수정 모드 진입 ─────────────────────────────────────────────────────────────
function enterEditMode(id, data){
  _editId = id;
  if($("ntTitle"))   $("ntTitle").value   = data.title || "";
  if($("ntText"))    $("ntText").value    = data.text  || "";
  if($("ntPinned"))  $("ntPinned").value  = data.pinned  ? "1" : "0";
  if($("ntVisible")) $("ntVisible").value = data.visible === false ? "0" : "1";

  const btn = $("btnSave");
  if(btn) btn.textContent = "수정 저장";

  const editBar = $("editModeBar");
  if(editBar){
    editBar.style.display = "flex";
    editBar.querySelector(".edit-mode-label").textContent = `수정 중: ${data.title || id}`;
  }

  $("ntTitle")?.focus();
  setHelp("수정할 내용을 변경한 뒤 [수정 저장]을 눌러주세요.");
}

// ── 수정 모드 해제 ─────────────────────────────────────────────────────────────
function exitEditMode(){
  _editId = null;
  $("noticeForm")?.reset();

  const btn = $("btnSave");
  if(btn) btn.textContent = "저장";

  const editBar = $("editModeBar");
  if(editBar) editBar.style.display = "none";

  setHelp("");
}

// ── 목록 로드 ──────────────────────────────────────────────────────────────────
async function loadList(){
  const list = $("noticeList");
  if(!list) return;
  list.innerHTML = "";

  try{
    const q = query(collection(db, "notices"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if(snap.empty){
      const li = document.createElement("li");
      li.textContent = "공지 없음";
      list.appendChild(li);
      return;
    }

    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));

    docs.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if(ap !== bp) return bp - ap;
      return toMillis(b.createdAt) - toMillis(a.createdAt);
    });

    docs.forEach((v) => {
      const li = document.createElement("li");
      li.className = "an-item";
      if(_editId === v.id) li.classList.add("an-item--editing");

      const top = document.createElement("div");
      top.className = "an-item-top";

      const title = document.createElement("div");
      title.className = "an-item-title";
      title.textContent = v.title || "(제목 없음)";

      const badges = document.createElement("div");
      badges.className = "an-badges";
      if(v.pinned) badges.appendChild(badge("고정"));
      if(v.visible === false) badges.appendChild(badge("비공개"));

      top.appendChild(title);
      top.appendChild(badges);

      const text = document.createElement("div");
      text.className = "an-item-text";
      text.textContent = v.text || "";

      li.appendChild(top);
      li.appendChild(text);

      // 관리자 액션 버튼
      if(_isAdmin){
        const actions = document.createElement("div");
        actions.className = "an-item-actions";

        const btnEdit = document.createElement("button");
        btnEdit.className = "btn btn--ghost btn--xs";
        btnEdit.textContent = "수정";
        btnEdit.type = "button";
        btnEdit.onclick = () => enterEditMode(v.id, v);

        const btnDel = document.createElement("button");
        btnDel.className = "btn btn--danger btn--xs";
        btnDel.textContent = "삭제";
        btnDel.type = "button";
        btnDel.onclick = async () => {
          if(!confirm(`"${v.title}" 공지를 삭제하시겠습니까?`)) return;
          try{
            await deleteDoc(doc(db, "notices", v.id));
            if(_editId === v.id) exitEditMode();
            await loadList();
          }catch(e){
            alert("삭제 실패: " + (e.message || e));
          }
        };

        actions.appendChild(btnEdit);
        actions.appendChild(btnDel);
        li.appendChild(actions);
      }

      list.appendChild(li);
    });
  }catch(e){
    console.warn("loadList failed:", e);
    const li = document.createElement("li");
    li.textContent = "목록을 불러오지 못했습니다.";
    list.appendChild(li);
  }
}

// ── 폼 바인딩 ──────────────────────────────────────────────────────────────────
function bindForm(user){
  const form     = $("noticeForm");
  const btnReset = $("btnReset");

  if(btnReset){
    btnReset.onclick = () => {
      exitEditMode();
    };
  }

  if(!form) return;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    setHelp("저장 중…");

    try{
      const title   = sanitize($("ntTitle")?.value);
      const text    = sanitize($("ntText")?.value);
      const pinned  = $("ntPinned")?.value === "1";
      const visible = $("ntVisible")?.value === "1";

      if(!title || !text){
        setHelp("제목과 내용을 입력해 주세요.", true);
        return;
      }

      if(_editId){
        // ── 수정 ──
        await updateDoc(doc(db, "notices", _editId), {
          title,
          text,
          pinned,
          visible,
          updatedAt:    serverTimestamp(),
          updatedByUid: user?.uid   || "",
        });
        exitEditMode();
        setHelp("수정 완료");
      } else {
        // ── 신규 등록 ──
        await addDoc(collection(db, "notices"), {
          title,
          text,
          pinned,
          visible,
          createdAt:   serverTimestamp(),
          updatedAt:   serverTimestamp(),
          authorUid:   user?.uid   || "",
          authorEmail: user?.email || "",
        });
        form.reset();
        setHelp("저장 완료");
      }

      await loadList();
    }catch(e){
      console.warn("save notice failed:", e);
      const msg = String(e?.message || e || "");
      if(msg.includes("Missing or insufficient permissions")){
        setHelp("권한이 없습니다. firestore.rules의 /notices 규칙을 확인해 주세요.", true);
      }else{
        setHelp("저장 실패: 콘솔 로그를 확인해 주세요.", true);
      }
    }
  };
}

// ── 인증 상태 감지 ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  _currentUser = user;

  if(!user){
    setState("로그인이 필요합니다.");
    _isAdmin = false;
    setFormEnabled(false);
    await loadList();
    return;
  }

  _isAdmin = await isAdmin(user.uid, user.email);

  if(!_isAdmin){
    setState("관리자 권한이 없습니다.");
    setFormEnabled(false);
    await loadList();
    return;
  }

  setState("관리자 모드");
  setFormEnabled(true);
  bindForm(user);
  await loadList();
});
