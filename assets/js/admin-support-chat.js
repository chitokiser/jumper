// /assets/js/admin-support-chat.js
import {
  collection, doc, addDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "/assets/js/firebase-init.js";
import { onAuthReady } from "/assets/js/auth.js";

let _selectedUid = null;
let _unsubSessions = null;
let _unsubMsgs = null;
let _unsubAdminStatus = null;
let _isOnline = false;

function g(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function setupAdminChat() {
  const btnToggle   = g("btnToggleAdminOnline");
  const statusLabel = g("adminOnlineLabel");
  const sessionList = g("chatSessionList");
  const msgList     = g("adminChatMessages");
  const form        = g("adminChatForm");
  const input       = g("adminChatInput");
  const targetLabel = g("adminChatTarget");

  if (!btnToggle) return;

  _unsubAdminStatus?.();
  _unsubAdminStatus = onSnapshot(doc(db, "admin_status", "main"), (snap) => {
    _isOnline = snap.exists() && snap.data().online === true;
    if (statusLabel) statusLabel.textContent = _isOnline ? "🟢 온라인" : "🔴 오프라인";
    if (btnToggle)   btnToggle.textContent   = _isOnline ? "오프라인 전환" : "온라인 전환";
  });

  btnToggle.addEventListener("click", async () => {
    await setDoc(doc(db, "admin_status", "main"), {
      online: !_isOnline,
      updatedAt: serverTimestamp(),
    });
  });

  _unsubSessions = onSnapshot(
    query(collection(db, "support_chats"), orderBy("lastAt", "desc")),
    (snap) => {
      if (!sessionList) return;
      let html = "";
      for (const d of snap.docs) {
        const { displayName, email, lastMessage, hasUnread } = d.data();
        const name   = displayName || email || d.id.slice(0, 8) + "…";
        const badge  = hasUnread ? `<span class="sc-admin-badge">N</span>` : "";
        const active = _selectedUid === d.id ? " is-active" : "";
        html += `<div class="sc-session-item${active}" data-uid="${esc(d.id)}" title="${esc(email || d.id)}">
          <div class="sc-session-name">${esc(name)}${badge}</div>
          <div class="sc-session-preview">${esc(lastMessage || "")}</div>
        </div>`;
      }
      sessionList.innerHTML = html || `<div class="muted" style="font-size:13px;padding:12px;">채팅 없음</div>`;
    }
  );

  sessionList?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-uid]");
    if (!item) return;
    openSession(item.dataset.uid, sessionList, msgList, targetLabel);
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input?.value.trim();
    if (!text || !_selectedUid) return;
    input.value = "";
    await sendAdminMsg(_selectedUid, text);
  });
}

function openSession(uid, sessionList, msgList, targetLabel) {
  _selectedUid = uid;
  sessionList?.querySelectorAll("[data-uid]").forEach(el => {
    el.classList.toggle("is-active", el.dataset.uid === uid);
  });
  if (targetLabel) targetLabel.textContent = `대화 상대: ${uid}`;

  _unsubMsgs?.();

  if (!msgList) return;
  msgList.innerHTML = `<div class="muted" style="font-size:13px;padding:12px;">불러오는 중…</div>`;

  // 세션 열 때 1회만 hasUnread 초기화 (onSnapshot 콜백 안에서 매번 쓰지 않음)
  updateDoc(doc(db, "support_chats", uid), { hasUnread: false }).catch(() => {});

  _unsubMsgs = onSnapshot(
    query(collection(db, "support_chats", uid, "messages"), orderBy("createdAt", "asc")),
    (snap) => {
      let html = "";
      for (const d of snap.docs) {
        const { text, sender, createdAt } = d.data();
        const t = createdAt
          ? new Date(createdAt.seconds * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
          : "";
        const cls = sender === "admin" ? "sc-msg sc-msg--admin" : sender === "bot" ? "sc-msg sc-msg--bot" : "sc-msg sc-msg--user";
        const label = sender === "bot" ? `<span class="sc-msg-label">🤖 AI</span>` : "";
        html += `<div class="${cls}">${label}<span class="sc-msg-text">${esc(text)}</span><span class="sc-msg-time">${t}</span></div>`;
      }
      msgList.innerHTML = html || `<div class="muted" style="font-size:13px;text-align:center;padding:24px;">메시지 없음</div>`;
      msgList.scrollTop = msgList.scrollHeight;
    }
  );
}

async function sendAdminMsg(uid, text) {
  await addDoc(collection(db, "support_chats", uid, "messages"), {
    text,
    sender: "admin",
    createdAt: serverTimestamp(),
    readByUser: false,
  });
  await updateDoc(doc(db, "support_chats", uid), {
    lastMessage: text,
    lastAt: serverTimestamp(),
  });
}

onAuthReady(({ loggedIn }) => {
  if (!loggedIn) return;
  setupAdminChat();
});
