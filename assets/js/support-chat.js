// /assets/js/support-chat.js
import { watchAuth } from "/assets/js/auth.js";
import {
  collection, doc, addDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "/assets/js/firebase-init.js";

let _unsubMsgs = null;
let _uid = null;
let _isOpen = false;
let _unreadRefs = [];

function g(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function setup() {
  const btnOpen  = g("btnSupportChat");
  const widget   = g("supportChatWidget");
  const btnClose = g("scBtnClose");
  const form     = g("scForm");
  const input    = g("scInput");
  const msgs     = g("scMessages");
  const statusEl = g("scAdminStatus");

  if (!btnOpen || !widget) return;

  onSnapshot(doc(db, "admin_status", "main"), (snap) => {
    const on = snap.exists() && snap.data().online === true;
    if (statusEl) statusEl.textContent = on ? "🟢 온라인" : "🔴 오프라인";
  });

  btnOpen.addEventListener("click", () => {
    _isOpen = !_isOpen;
    widget.classList.toggle("hidden", !_isOpen);
    if (_isOpen) {
      clearBadge(btnOpen);
      markRead();
      msgs && setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 30);
    }
  });

  btnClose?.addEventListener("click", () => {
    _isOpen = false;
    widget.classList.add("hidden");
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input?.value.trim();
    if (!text || !_uid) return;
    input.value = "";
    await sendMsg(_uid, text);
  });

  watchAuth(async (payload) => {
    const user = payload?.user ?? null;

    if (!user) {
      _uid = null;
      _unsubMsgs?.();
      _unsubMsgs = null;
      _unreadRefs = [];
      clearBadge(btnOpen);
      if (msgs) msgs.innerHTML = `<div class="sc-login-req">로그인 후 이용 가능합니다.</div>`;
      return;
    }

    if (_uid === user.uid) return;
    _uid = user.uid;

    _unsubMsgs?.();
    _unsubMsgs = null;

    const chatRef = doc(db, "support_chats", user.uid);
    const snap = await getDoc(chatRef);
    if (!snap.exists()) {
      await setDoc(chatRef, {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        lastMessage: "",
        lastAt: serverTimestamp(),
        hasUnread: false,
      });
    }

    _unsubMsgs = onSnapshot(
      query(collection(db, "support_chats", user.uid, "messages"), orderBy("createdAt", "asc")),
      (snap) => {
        if (msgs) renderMsgs(snap.docs, msgs);
        _unreadRefs = snap.docs
          .filter(d => d.data().sender === "admin" && !d.data().readByUser)
          .map(d => d.ref);

        if (_unreadRefs.length > 0 && !_isOpen) {
          btnOpen.dataset.badge = _unreadRefs.length > 9 ? "9+" : String(_unreadRefs.length);
          btnOpen.classList.add("has-badge");
        } else {
          clearBadge(btnOpen);
        }

        if (_isOpen && _unreadRefs.length > 0) markRead();
      }
    );
  });
}

function renderMsgs(docs, el) {
  if (!docs.length) {
    el.innerHTML = `<div class="sc-login-req">메시지가 없습니다.<br>문의 내용을 입력해 주세요.</div>`;
    return;
  }
  let html = "";
  for (const d of docs) {
    const { text, sender, createdAt } = d.data();
    const t = createdAt
      ? new Date(createdAt.seconds * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
      : "";
    const cls = sender === "admin" ? "sc-msg sc-msg--admin" : sender === "bot" ? "sc-msg sc-msg--bot" : "sc-msg sc-msg--user";
    const label = sender === "bot" ? `<span class="sc-msg-label">🤖 AI 자동응답</span>` : "";
    html += `<div class="${cls}">${label}<span class="sc-msg-text">${esc(text)}</span><span class="sc-msg-time">${t}</span></div>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

async function sendMsg(uid, text) {
  await addDoc(collection(db, "support_chats", uid, "messages"), {
    text,
    sender: "user",
    createdAt: serverTimestamp(),
    readByUser: true,
  });
  await updateDoc(doc(db, "support_chats", uid), {
    lastMessage: text,
    lastAt: serverTimestamp(),
    hasUnread: true,
  });
}

function markRead() {
  if (!_unreadRefs.length) return;
  const refs = [..._unreadRefs];
  _unreadRefs = [];
  Promise.all(refs.map(ref => updateDoc(ref, { readByUser: true }))).catch(() => {});
}

function clearBadge(btn) {
  btn.dataset.badge = "";
  btn.classList.remove("has-badge");
}

if (document.getElementById("btnSupportChat")) {
  setup();
} else {
  window.addEventListener("partials:mounted", setup, { once: true });
}
