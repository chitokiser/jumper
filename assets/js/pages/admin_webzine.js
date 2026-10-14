// /assets/js/pages/admin_webzine.js
import { db, onAuthReady } from "/assets/js/auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { generateWebzineArticle, CATEGORY_THUMBNAILS, getRandomThumbnail } from "./webzine-ai.js";

const $ = (id) => document.getElementById(id);

let _merchantsCache = [];
let _currentGeneratedArticle = null;
let _currentUser = null;
let _isSuperAdmin = false;

/**
 * 수퍼 어드민 권한 검증
 * - email: daguri75@gmail.com, hexttokenopbnb@gmail.com
 * - admins/{uid} 문서 존재
 * - users/{uid} 문서의 role in ['SUPER_ADMIN', 'admin', 'ADMIN']
 */
async function checkSuperAdmin(user) {
  if (!user) return false;

  const email = (user.email || "").toLowerCase().trim();
  if (email === "daguri75@gmail.com") {
    return true;
  }

  // 1) admins/{uid} 컬렉션 확인
  try {
    const aSnap = await getDoc(doc(db, "admins", user.uid));
    if (aSnap.exists()) return true;
  } catch (err) {
    console.warn("admins doc check note:", err);
  }

  // 2) users/{uid} role 확인
  try {
    const uSnap = await getDoc(doc(db, "users", user.uid));
    if (uSnap.exists()) {
      const ud = uSnap.data() || {};
      if (ud.isAdmin === true || ["SUPER_ADMIN", "ADMIN", "admin"].includes(ud.role)) {
        return true;
      }
    }
  } catch (err) {
    console.warn("users doc check note:", err);
  }

  return false;
}

/**
 * 실제 가맹점 목록 로드 (merchants 컬렉션에서 실제 등록된 가맹점만 추출)
 * - 더미 데이터나 수동 입력(custom) 옵션 완전 배제
 */
async function loadRealMerchants() {
  const sel = $("selMerchant");
  if (!sel) return;

  sel.innerHTML = `<option value="">== 등록된 실제 가맹점을 불러오는 중... ==</option>`;

  try {
    const snap = await getDocs(collection(db, "merchants"));
    const list = [];

    snap.forEach((d) => {
      const data = d.data() || {};
      // 활성화된 실제 가맹점만 포함
      if (data.active !== false) {
        list.push({
          id: d.id,
          name: data.name || data.merchantName || `가맹점 #${d.id}`,
          category: data.category || data.cat || "K-컬처 공식 가맹점",
          region: data.region || data.address || "하노이",
          address: data.address || data.region || "하노이",
          phone: data.phone || data.tel || "024-3787-8899",
          hours: data.hours || "매일 11:00 ~ 23:00",
          signatureMenu: data.signatureMenu || data.menu || "대표 시그니처 메뉴",
          description: data.description || data.desc || "베스트클럽 공식 인증 가맹점",
          benefit: data.benefit || "베스트클럽 결제 시 5% 포인트 페이백 + 잭팟 보너스티켓(BT) 즉시 발급!",
          qrUrl: `/pay.html?merchant=${encodeURIComponent(d.id)}`
        });
      }
    });

    _merchantsCache = list;

    if (list.length === 0) {
      sel.innerHTML = `<option value="">⚠️ 등록된 실제 가맹점이 없습니다 (merchants DB 확인 필요)</option>`;
      return;
    }

    let optionsHtml = `<option value="">== 실제 가맹점을 선택해 주세요 (총 ${list.length}곳) ==</option>`;
    optionsHtml += list.map((m) => `
      <option value="${m.id}">${m.name} (ID: ${m.id} | ${m.region})</option>
    `).join("");

    sel.innerHTML = optionsHtml;

    const embedSel = $("embedSelMerchant");
    if (embedSel) {
      embedSel.innerHTML = optionsHtml;
      if (list.length > 0) embedSel.value = list[0].id;
    }
    updateEmbedToolPreview();
  } catch (err) {
    console.error("실제 가맹점 목록 로드 실패:", err);
    sel.innerHTML = `<option value="">가맹점 로드 오류: ${err.message}</option>`;
  }
}

/**
 * 썸네일 추천 피커 렌더링
 */
function renderThumbnailPicker(category) {
  const wrap = $("thumbPicker");
  const inp = $("edThumbUrl");
  if (!wrap) return;

  const thumbs = CATEGORY_THUMBNAILS[category] || CATEGORY_THUMBNAILS["K-푸드"];
  wrap.innerHTML = thumbs.map((url, idx) => `
    <img src="${url}" class="thumb-opt ${idx === 0 ? "selected" : ""}" data-url="${url}" alt="썸네일 추천" />
  `).join("");

  if (inp && (!inp.value || thumbs.includes(inp.value))) {
    inp.value = thumbs[0];
  }

  wrap.querySelectorAll(".thumb-opt").forEach((img) => {
    img.addEventListener("click", () => {
      wrap.querySelectorAll(".thumb-opt").forEach((i) => i.classList.remove("selected"));
      img.classList.add("selected");
      if (inp) inp.value = img.dataset.url;
    });
  });
}

/**
 * AI 기사 생성 실행
 */
async function handleAiGenerate() {
  if (!_isSuperAdmin) {
    alert("⚠️ 수퍼 어드민 권한이 필요합니다.");
    return;
  }

  const btn = $("btnAiGenerate");
  const selMerch = $("selMerchant");
  const selCat = $("selCategory");
  const inpTopic = $("inpTopic");
  const inpKey = $("inpKeywords");

  const merchantId = selMerch ? selMerch.value : "";
  if (!merchantId) {
    alert("연동할 실제 가맹점을 드롭다운에서 먼저 선택해 주세요.");
    selMerch?.focus();
    return;
  }

  // 선택된 실제 가맹점 데이터 검증
  const mData = _merchantsCache.find((m) => m.id === merchantId);
  if (!mData) {
    alert("선택하신 가맹점 정보를 찾을 수 없습니다. 목록을 다시 확인해 주세요.");
    return;
  }

  const category = selCat ? selCat.value : "K-푸드";
  const topic = inpTopic ? inpTopic.value.trim() : "";
  const keywords = inpKey ? inpKey.value.trim() : "";

  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> 실제 가맹점(${mData.name}) 데이터 기반 AI 기사 작성 중...`;

  try {
    const article = await generateWebzineArticle({
      merchantId,
      category,
      topic,
      keywords,
      merchantData: mData
    });

    _currentGeneratedArticle = {
      ...article,
      merchantInfo: mData
    };

    // 에디터 폼에 값 채우기
    if ($("edTitle")) $("edTitle").value = article.title || "";
    if ($("edSubtitle")) $("edSubtitle").value = article.subtitle || "";
    if ($("edSummary")) $("edSummary").value = article.summary || "";
    if ($("edContent")) $("edContent").value = article.content || "";
    if ($("edThumbUrl")) $("edThumbUrl").value = article.thumbnailUrl || getRandomThumbnail(category);

    const sns = article.sns || {};
    if ($("edSnsInsta")) $("edSnsInsta").value = sns.instagram || "";
    if ($("edSnsX")) $("edSnsX").value = sns.x || "";
    if ($("edSnsThreads")) $("edSnsThreads").value = sns.threads || "";
    if ($("edSnsFb")) $("edSnsFb").value = sns.facebook || "";

    renderThumbnailPicker(category);

    // 에디터 섹션으로 부드럽게 스크롤
    const edSec = $("editorSection");
    if (edSec) edSec.scrollIntoView({ behavior: "smooth" });

    alert(`✨ 실제 가맹점 [${mData.name}] 연동 AI 기사 생성이 완료되었습니다!\n아래 에디터에서 내용을 검수한 후 [즉시 발행하기]를 눌러주세요.`);
  } catch (err) {
    console.error("AI Generate Error:", err);
    alert("AI 기사 생성 중 오류가 발생했습니다: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>✨</span> AI 기사 & SNS 숏폼 원클릭 생성하기`;
  }
}

/**
 * 기사 발행하기 (Publish to Firestore)
 */
async function handlePublish() {
  if (!_isSuperAdmin) {
    alert("⚠️ 수퍼 어드민 권한이 필요합니다.");
    return;
  }

  const btn = $("btnPublishArticle");
  const title = $("edTitle")?.value.trim();
  const subtitle = $("edSubtitle")?.value.trim();
  const summary = $("edSummary")?.value.trim();
  const content = $("edContent")?.value.trim();
  const thumbnailUrl = $("edThumbUrl")?.value.trim() || getRandomThumbnail("K-푸드");
  const category = $("selCategory")?.value || "K-푸드";

  if (!title) {
    alert("기사 제목을 입력해 주세요.");
    $("edTitle")?.focus();
    return;
  }
  if (!content) {
    alert("기사 본문을 입력해 주세요.");
    $("edContent")?.focus();
    return;
  }

  // 선택된 실제 가맹점 검증
  const selMerch = $("selMerchant");
  const merchantId = selMerch ? selMerch.value : "";
  const merch = _currentGeneratedArticle?.merchantInfo || _merchantsCache.find((m) => m.id === merchantId);

  if (!merch) {
    alert("연동할 실제 가맹점이 올바르게 선택되지 않았습니다.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> 웹진에 발행 중...`;

  try {
    const sns = {
      instagram: $("edSnsInsta")?.value.trim() || "",
      x: $("edSnsX")?.value.trim() || "",
      threads: $("edSnsThreads")?.value.trim() || "",
      facebook: $("edSnsFb")?.value.trim() || ""
    };

    const newDoc = {
      title,
      subtitle: subtitle || "",
      summary: summary || title,
      content,
      category,
      thumbnailUrl,
      author: "베스트클럽 에디토리얼 팀",
      readTime: "3분 읽기",
      dateStr: new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }),
      merchantInfo: merch,
      sns,
      tags: ["베스트클럽", category, merch.name],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await addDoc(collection(db, "webzine_articles"), newDoc);

    alert(`🎉 기사가 성공적으로 발행되었습니다!\n가맹점: [${merch.name}]\n베스트 매거진(kca_webzine.html)에 즉시 노출됩니다.`);
    loadPublishedArticles();
  } catch (err) {
    console.error("Publish Error:", err);
    alert("발행 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>🚀</span> 베스트 매거진에 즉시 발행하기 (Publish)`;
  }
}

/**
 * 발행된 기사 목록 로드 & 삭제 기능
 */
async function loadPublishedArticles() {
  const tbody = $("articlesTableBody");
  if (!tbody) return;

  try {
    const q = query(collection(db, "webzine_articles"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">발행된 기사가 없습니다. 위에서 첫 번째 AI 기사를 발행해 보세요!</td></tr>`;
      return;
    }

    const rows = [];
    snap.forEach((d) => {
      const a = d.data();
      const id = d.id;
      rows.push(`
        <tr>
          <td>
            <img src="${a.thumbnailUrl || ''}" style="width:60px; height:40px; object-fit:cover; border-radius:6px;" alt="" />
          </td>
          <td>
            <strong>${a.title}</strong>
          </td>
          <td>
            <span style="background:#ede9fe; color:#7c3aed; font-weight:700; padding:3px 8px; border-radius:6px; font-size:0.75rem;">${a.category || "K-컬처"}</span>
          </td>
          <td>
            <strong>${a.merchantInfo?.name || "-"}</strong>
            ${a.merchantInfo?.id ? `<span style="font-size:0.75rem; color:#94a3b8; display:block;">(${a.merchantInfo.id})</span>` : ""}
          </td>
          <td>
            ${a.dateStr || "-"}
          </td>
          <td>
            ${_isSuperAdmin ? `<button class="btn-delete-article" data-id="${id}" style="background:#fee2e2; color:#ef4444; border:none; padding:4px 10px; border-radius:6px; font-weight:700; cursor:pointer;">삭제</button>` : `<span style="color:#94a3b8; font-size:0.8rem;">권한 없음</span>`}
          </td>
        </tr>
      `);
    });

    tbody.innerHTML = rows.join("");

    if (_isSuperAdmin) {
      tbody.querySelectorAll(".btn-delete-article").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("정말 이 기사를 삭제하시겠습니까?")) return;
          try {
            await deleteDoc(doc(db, "webzine_articles", b.dataset.id));
            alert("삭제되었습니다.");
            loadPublishedArticles();
          } catch (e) {
            alert("삭제 실패: " + e.message);
          }
        };
      });
    }
  } catch (err) {
    console.warn("loadPublishedArticles error:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:20px;">기사 목록 로드 오류: ${err.message}</td></tr>`;
  }
}

/**
 * 가맹점 자체 홈페이지 임베드 위젯 실시간 미리보기 및 코드 생성
 */
function updateEmbedToolPreview() {
  const embedSel = $("embedSelMerchant");
  const colorText = $("embedColorText");
  const colorPicker = $("embedColorPicker");
  const layoutSel = $("embedLayout");
  const modeSel = $("embedMode");

  const mId = embedSel ? embedSel.value : "";
  const theme = colorText ? colorText.value.trim() : "#7c3aed";
  const layout = layoutSel ? layoutSel.value : "card";
  const mode = modeSel ? modeSel.value : "light";

  const baseUrl = window.location.origin.includes("localhost")
    ? window.location.origin
    : "https://bestclubvn.netlify.app";

  const widgetRelUrl = `/kca_webzine_widget.html?merchant=${encodeURIComponent(mId)}&theme=${encodeURIComponent(theme)}&layout=${layout}&mode=${mode}`;
  const widgetFullUrl = `${baseUrl}${widgetRelUrl}`;

  // 실시간 미리보기 iFrame 및 외부 링크 업데이트
  const previewIframe = $("embedPreviewIframe");
  if (previewIframe && previewIframe.src !== widgetFullUrl) {
    previewIframe.src = widgetRelUrl;
  }
  const btnNewTab = $("btnOpenWidgetNewTab");
  if (btnNewTab) btnNewTab.href = widgetRelUrl;

  // 1) 표준 iframe 코드 생성
  const iframeH = layout === "banner" ? "340" : (layout === "feed" ? "680" : "500");
  const iframeCode = `<!-- [BestClub Webzine] 가맹점 웹진 위젯 (반응형 iframe) -->\n<iframe src="${widgetFullUrl}" width="100%" height="${iframeH}" frameborder="0" style="border:none; border-radius:14px; overflow:hidden; width:100%; display:block;" loading="lazy" title="BestClub Webzine"></iframe>`;
  if ($("codeIframeText")) $("codeIframeText").value = iframeCode;

  // 2) 경량 JS 위젯 SDK 태그 생성
  const jsCode = `<!-- [BestClub Webzine] 가맹점 웹진 위젯 (JavaScript SDK) -->\n<div id="bestclub-webzine-widget" data-merchant="${mId}" data-theme="${theme}" data-layout="${layout}" data-mode="${mode}"></div>\n<script src="${baseUrl}/assets/js/webzine-widget.js" async><\/script>`;
  if ($("codeJsText")) $("codeJsText").value = jsCode;
}

/**
 * 이벤트 바인딩
 */
function initEvents() {
  const btnGen = $("btnAiGenerate");
  if (btnGen) btnGen.onclick = handleAiGenerate;

  const btnPub = $("btnPublishArticle");
  if (btnPub) btnPub.onclick = handlePublish;

  const selCat = $("selCategory");
  if (selCat) {
    selCat.onchange = () => {
      renderThumbnailPicker(selCat.value);
    };
  }

  // ── 가맹점 임베드 커스터마이징 툴 이벤트 ──
  const embedSel = $("embedSelMerchant");
  if (embedSel) embedSel.onchange = updateEmbedToolPreview;

  const layoutSel = $("embedLayout");
  if (layoutSel) layoutSel.onchange = updateEmbedToolPreview;

  const modeSel = $("embedMode");
  if (modeSel) modeSel.onchange = updateEmbedToolPreview;

  const colorPicker = $("embedColorPicker");
  const colorText = $("embedColorText");
  if (colorPicker && colorText) {
    colorPicker.oninput = () => {
      colorText.value = colorPicker.value;
      updateEmbedToolPreview();
    };
    colorText.oninput = () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(colorText.value.trim())) {
        colorPicker.value = colorText.value.trim();
      }
      updateEmbedToolPreview();
    };
  }

  // 프리셋 컬러 칩 클릭
  document.querySelectorAll(".btn-color-preset").forEach((btn) => {
    btn.onclick = () => {
      const c = btn.dataset.color;
      if (colorPicker) colorPicker.value = c;
      if (colorText) colorText.value = c;
      updateEmbedToolPreview();
    };
  });

  // 코드 복사 버튼
  const btnCopyIframe = $("btnCopyIframeCode");
  if (btnCopyIframe) {
    btnCopyIframe.onclick = () => {
      const text = $("codeIframeText")?.value;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btnCopyIframe.textContent;
          btnCopyIframe.textContent = "복사 완료! ✅";
          setTimeout(() => { btnCopyIframe.textContent = orig; }, 1500);
        });
      }
    };
  }

  const btnCopyJs = $("btnCopyJsCode");
  if (btnCopyJs) {
    btnCopyJs.onclick = () => {
      const text = $("codeJsText")?.value;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btnCopyJs.textContent;
          btnCopyJs.textContent = "복사 완료! ✅";
          setTimeout(() => { btnCopyJs.textContent = orig; }, 1500);
        });
      }
    };
  }
}

/**
 * 초기화 및 권한 제어
 */
function boot() {
  initEvents();

  onAuthReady(async ({ loggedIn, role, user, profile }) => {
    _currentUser = user;
    const authStatusText = $("authStatusText");
    const authStatusBanner = $("authStatusBanner");
    const cmsMainContent = $("cmsMainContent");
    const accessDeniedCard = $("accessDeniedCard");

    if (!loggedIn || !user) {
      _isSuperAdmin = false;
      if (authStatusText) {
        authStatusText.innerHTML = `<span style="color:#ef4444;">🔒</span> <span>로그인이 필요합니다. 최고 관리자 계정으로 로그인해 주세요.</span>`;
      }
      if (authStatusBanner) {
        authStatusBanner.style.background = "#fff1f2";
        authStatusBanner.style.borderColor = "#fecdd3";
      }
      if (cmsMainContent) cmsMainContent.style.display = "none";
      if (accessDeniedCard) accessDeniedCard.style.display = "block";
      return;
    }

    // 수퍼 어드민 권한 체크
    _isSuperAdmin = await checkSuperAdmin(user);

    if (!_isSuperAdmin) {
      // 일반 사용자 또는 권한 없는 계정 차단
      if (authStatusText) {
        authStatusText.innerHTML = `
          <span style="color:#ef4444; font-size:1.1rem;">🚫</span>
          <span>로그인 계정: <b>${user.email}</b> | <b style="color:#dc2626;">수퍼 어드민(SUPER ADMIN) 권한이 없습니다.</b></span>
        `;
      }
      if (authStatusBanner) {
        authStatusBanner.style.background = "#fff1f2";
        authStatusBanner.style.borderColor = "#fecdd3";
      }
      if (cmsMainContent) cmsMainContent.style.display = "none";
      if (accessDeniedCard) accessDeniedCard.style.display = "block";
      return;
    }

    // 수퍼 어드민 정상 승인
    if (authStatusText) {
      authStatusText.innerHTML = `
        <span style="color:#7c3aed; font-size:1.1rem;">🛡️</span>
        <span>최고 관리자 인증 완료: <b>${user.email}</b> | <b style="color:#059669;">실제 가맹점 연동 AI 기사 발행 권한 활성화됨</b></span>
      `;
    }
    if (authStatusBanner) {
      authStatusBanner.style.background = "#f0fdf4";
      authStatusBanner.style.borderColor = "#bbf7d0";
    }
    if (cmsMainContent) cmsMainContent.style.display = "block";
    if (accessDeniedCard) accessDeniedCard.style.display = "none";

    // 실제 가맹점 목록 및 발행 기사 로드
    await loadRealMerchants();
    renderThumbnailPicker("K-푸드");
    loadPublishedArticles();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
