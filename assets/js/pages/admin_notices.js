// /assets/js/pages/admin_notices.js
// 공지관리: 관리자만 작성 가능
// 관리자 기준: admins/{uid} 존재 또는 운영자 이메일(daguri75@gmail.com)

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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const OPERATOR_EMAILS = new Set(["daguri75@gmail.com"]);

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

async function loadList(){
  const list = $("noticeList");
  if(!list) return;
  list.innerHTML = "";

  try{
    const q = query(
      collection(db, "notices"),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);

    if(snap.empty){
      const li = document.createElement("li");
      li.textContent = "공지 없음";
      list.appendChild(li);
      return;
    }

    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));

    // pinned 상단 정렬(클라)
    docs.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if(ap !== bp) return bp - ap;
      return toMillis(b.createdAt) - toMillis(a.createdAt);
    });

    docs.forEach((v) => {
      const li = document.createElement("li");
      li.className = "an-item";

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
      list.appendChild(li);
    });
  }catch(e){
    console.warn("loadList failed:", e);
    const li = document.createElement("li");
    li.textContent = "목록을 불러오지 못했습니다.";
    list.appendChild(li);
  }
}

function bindForm(user){
  const form = $("noticeForm");
  const btnReset = $("btnReset");

  if(btnReset){
    btnReset.onclick = () => {
      form?.reset();
      setHelp("");
    };
  }

  if(!form) return;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    setHelp("저장 중…");

    try{
      const title = sanitize($("ntTitle")?.value);
      const text  = sanitize($("ntText")?.value);
      const pinned = $("ntPinned")?.value === "1";
      const visible = $("ntVisible")?.value === "1";

      if(!title || !text){
        setHelp("제목과 내용을 입력해 주세요.", true);
        return;
      }

      await addDoc(collection(db, "notices"), {
        title,
        text,
        pinned,
        visible,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        authorUid: user?.uid || "",
        authorEmail: user?.email || "",
      });

      form.reset();
      setHelp("저장 완료");
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

onAuthStateChanged(auth, async (user) => {
  if(!user){
    setState("로그인이 필요합니다.");
    setFormEnabled(false);
    await loadList();
    return;
  }

  const admin = await isAdmin(user.uid, user.email);

  if(!admin){
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
