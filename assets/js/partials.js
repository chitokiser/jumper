// /assets/js/partials.js
const _HDR_T = {
  vi: {
    hdr_explore: 'Khám phá', hdr_treasure: 'Tìm kho báu', hdr_stay: 'Chỗ nghỉ',
    hdr_sights: 'Điểm tham quan', hdr_food: 'Ẩm thực', hdr_shopping: 'Mua sắm',
    hdr_benefits: 'Quyền lợi Jump', hdr_limousine: 'Jump Limousine', hdr_dao: 'Biểu quyết DAO',
    hdr_signup: 'Đăng ký', hdr_my_services: 'Dịch vụ của tôi', hdr_wallet: 'Ví của tôi',
    hdr_exchange: 'Sàn giao dịch Jump', hdr_used: 'Chợ đồ cũ', hdr_mall: 'Cửa hàng hội viên',
    hdr_orders: 'Đơn hàng của tôi', hdr_sales: 'Trung tâm bán hàng',
    hdr_merchant_reg: 'Đăng ký cửa hàng', hdr_homestay_new: 'Tạo homestay mới',
    hdr_product_add: 'Thêm sản phẩm', hdr_my_products: 'Quản lý sản phẩm',
    hdr_qr_pay: 'Thanh toán QR', hdr_admin: 'Quản trị', hdr_debug: 'Kiểm tra debug',
    hdr_coop_admin: 'Quản lý hợp tác xã', hdr_approval: 'Duyệt/Quản lý SP',
    hdr_order_admin: 'Quản lý đơn hàng', hdr_settlement: 'Quản lý thanh toán',
    hdr_notice_admin: 'Quản lý thông báo', hdr_places: 'Đăng ký địa điểm',
    hdr_banners: 'Quản lý banner', hdr_jackpot: 'Quản lý rút jackpot',
    hdr_buggy: 'Quản lý xe buggy', hdr_member_badge: '👑 Hội viên chính',
    hdr_member_join: 'Đăng ký hội viên', hdr_login: 'Đăng nhập Google', hdr_logout: 'Đăng xuất',
  },
  en: {
    hdr_explore: 'Explore', hdr_treasure: 'Treasure Hunt', hdr_stay: 'Stay',
    hdr_sights: 'Sights', hdr_food: 'Food', hdr_shopping: 'Shopping',
    hdr_benefits: 'Jump Benefits', hdr_limousine: 'Jump Limousine', hdr_dao: 'DAO Vote',
    hdr_signup: 'Sign Up', hdr_my_services: 'My Services', hdr_wallet: 'My Wallet',
    hdr_exchange: 'Jump Exchange', hdr_used: 'Used Market', hdr_mall: 'Member Mall',
    hdr_orders: 'My Orders', hdr_sales: 'Sales Center',
    hdr_merchant_reg: 'Register Merchant', hdr_homestay_new: 'New Homestay',
    hdr_product_add: 'Add Product', hdr_my_products: 'My Products',
    hdr_qr_pay: 'QR Pay', hdr_admin: 'Admin', hdr_debug: 'Debug Check',
    hdr_coop_admin: 'Coop Management', hdr_approval: 'Approval/Products',
    hdr_order_admin: 'Order Management', hdr_settlement: 'Settlement',
    hdr_notice_admin: 'Notices', hdr_places: 'Add Place',
    hdr_banners: 'Banners', hdr_jackpot: 'Jackpot Withdrawal',
    hdr_buggy: 'Buggy Management', hdr_member_badge: '👑 Member',
    hdr_member_join: 'Join Member', hdr_login: 'Google Login', hdr_logout: 'Logout',
  },
  ko: {
    hdr_explore: '탐색', hdr_treasure: '보물찾기', hdr_stay: '잠자리',
    hdr_sights: '볼거리', hdr_food: '먹거리', hdr_shopping: '살거리',
    hdr_benefits: 'Jump혜택', hdr_limousine: '점프리무진', hdr_dao: 'DAO 의결',
    hdr_signup: '회원가입', hdr_my_services: '내 서비스', hdr_wallet: '내지갑',
    hdr_exchange: 'Jump 토큰거래소', hdr_used: '중고거래', hdr_mall: '회원전용몰',
    hdr_orders: '내 주문', hdr_sales: '판매센터',
    hdr_merchant_reg: '가맹점 등록', hdr_homestay_new: '홈스테이 신규생성',
    hdr_product_add: '상품 추가', hdr_my_products: '내 상품관리',
    hdr_qr_pay: 'QR 결제', hdr_admin: '관리자', hdr_debug: '디버그체크',
    hdr_coop_admin: '조합관리', hdr_approval: '승인/상품관리',
    hdr_order_admin: '주문관리', hdr_settlement: '정산관리',
    hdr_notice_admin: '공지관리', hdr_places: '장소등록',
    hdr_banners: '배너관리', hdr_jackpot: '잭팟 인출관리',
    hdr_buggy: '버기카 관리', hdr_member_badge: '👑 정회원',
    hdr_member_join: '정회원 가입', hdr_login: '구글 로그인', hdr_logout: '로그아웃',
  },
};

function applyHeaderI18n() {
  try {
    const saved = localStorage.getItem('town_lang');
    const lang = ['vi', 'en', 'ko'].includes(saved) ? saved : 'vi';
    const tbl = _HDR_T[lang] || _HDR_T.vi;
    document.querySelectorAll('[data-hdr-i18n]').forEach(function (el) {
      const key = el.dataset.hdrI18n;
      el.textContent = (tbl && tbl[key]) || (_HDR_T.vi[key]) || key;
    });
  } catch (e) {}
}
window.applyHeaderI18n = applyHeaderI18n;
window.addEventListener('lang:change', applyHeaderI18n);

const _FTR_T = {
  vi: {
    ftr_about_title:    'Giới thiệu',
    ftr_about_link:     'Giới thiệu JumpDAO',
    ftr_member_title:   'Hướng dẫn hội viên',
    ftr_register:       'Đăng ký hội viên',
    ftr_token_trade:    'Giao dịch token',
    ftr_exchange_link:  'Sàn giao dịch của chúng ta',
    ftr_support_title:  'Hỗ trợ khách hàng',
    ftr_faq:            'Câu hỏi thường gặp',
    ftr_partner:        'Liên hệ đối tác / nhập điểm',
    ftr_chat_btn:       '💬 Hỏi đáp 1:1',
    ftr_chat_title:     '💬 Hỏi đáp 1:1',
    ftr_chat_placeholder: 'Nhập tin nhắn...',
    ftr_chat_send:      'Gửi',
  },
  en: {
    ftr_about_title:    'About',
    ftr_about_link:     'About JumpDAO',
    ftr_member_title:   'Member Guide',
    ftr_register:       'Register',
    ftr_token_trade:    'Token Trade',
    ftr_exchange_link:  'Our Token Exchange',
    ftr_support_title:  'Support',
    ftr_faq:            'FAQ',
    ftr_partner:        'Partner / Listing Inquiry',
    ftr_chat_btn:       '💬 1:1 Chat',
    ftr_chat_title:     '💬 1:1 Chat',
    ftr_chat_placeholder: 'Enter message...',
    ftr_chat_send:      'Send',
  },
  ko: {
    ftr_about_title:    '소개',
    ftr_about_link:     'JumpDAO 소개',
    ftr_member_title:   '멤버 안내',
    ftr_register:       '회원 등록',
    ftr_token_trade:    '토큰 거래',
    ftr_exchange_link:  '우리들의 토큰거래소',
    ftr_support_title:  '고객 문의',
    ftr_faq:            '자주 묻는 질문',
    ftr_partner:        '제휴/입점 문의',
    ftr_chat_btn:       '💬 1:1 채팅 문의',
    ftr_chat_title:     '💬 1:1 채팅 문의',
    ftr_chat_placeholder: '메시지를 입력하세요...',
    ftr_chat_send:      '전송',
  },
};

function applyFooterI18n() {
  try {
    const saved = localStorage.getItem('town_lang');
    const lang = ['vi', 'en', 'ko'].includes(saved) ? saved : 'vi';
    const tbl = _FTR_T[lang] || _FTR_T.vi;
    document.querySelectorAll('[data-ftr-i18n]').forEach(function (el) {
      const key = el.dataset.ftrI18n;
      el.textContent = (tbl && tbl[key]) || (_FTR_T.vi[key]) || key;
    });
    document.querySelectorAll('[data-ftr-i18n-ph]').forEach(function (el) {
      const key = el.dataset.ftrI18nPh;
      el.placeholder = (tbl && tbl[key]) || (_FTR_T.vi[key]) || key;
    });
  } catch (e) {}
}
window.applyFooterI18n = applyFooterI18n;
window.addEventListener('lang:change', applyFooterI18n);

(() => {
  function abs(urlPath) {
    return new URL(urlPath, window.location.origin).toString();
  }

  function ensureCss(urlPath) {
    try {
      const url = abs(urlPath);
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
      const already = links.some((l) => String(l.href || "").split("?")[0] === String(url).split("?")[0]);
      if (already) return;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = urlPath;
      document.head.appendChild(link);
    } catch (e) {
      console.warn("ensureCss failed:", e?.message || e);
    }
  }

  function ensureFavicon() {
    try {
      const existing = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      if (existing) return;

      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/png";
      link.href = "/assets/images/jump/favicon.png";
      document.head.appendChild(link);
    } catch (e) {
      console.warn("ensureFavicon failed:", e?.message || e);
    }
  }

  function ensurePwaMeta() {
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        const m = document.createElement("link");
        m.rel = "manifest";
        m.href = "/manifest.webmanifest";
        document.head.appendChild(m);
      }

      if (!document.querySelector('meta[name="theme-color"]')) {
        const t = document.createElement("meta");
        t.name = "theme-color";
        t.content = "#2563eb";
        document.head.appendChild(t);
      }

      if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        const c = document.createElement("meta");
        c.name = "apple-mobile-web-app-capable";
        c.content = "yes";
        document.head.appendChild(c);
      }

      if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
        const s = document.createElement("meta");
        s.name = "apple-mobile-web-app-status-bar-style";
        s.content = "default";
        document.head.appendChild(s);
      }

      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const a = document.createElement("link");
        a.rel = "apple-touch-icon";
        a.href = "/assets/images/jump/favicon.png";
        document.head.appendChild(a);
      }
    } catch (e) {
      console.warn("ensurePwaMeta failed:", e?.message || e);
    }
  }

  function ensurePwaScript() {
    try {
      if (document.querySelector('script[data-pwa-install="1"]')) return;

      const s = document.createElement("script");
      s.src = "/assets/js/pwa-install.js";
      s.defer = true;
      s.dataset.pwaInstall = "1";
      document.head.appendChild(s);
    } catch (e) {
      console.warn("ensurePwaScript failed:", e?.message || e);
    }
  }

  function ensureInAppGuardScript() {
    try {
      if (document.querySelector('script[data-inapp-guard="1"]')) return;
      const s = document.createElement("script");
      s.src = "/assets/js/inapp-guard.js";
      s.defer = true;
      s.dataset.inappGuard = "1";
      document.head.appendChild(s);
    } catch (e) {
      console.warn("ensureInAppGuardScript failed:", e?.message || e);
    }
  }

  function ensureSupportChatScript() {
    try {
      if (document.querySelector('script[data-support-chat="1"]')) return;
      const s = document.createElement("script");
      s.type = "module";
      s.src = "/assets/js/support-chat.js";
      s.dataset.supportChat = "1";
      document.head.appendChild(s);
    } catch (e) {
      console.warn("ensureSupportChatScript failed:", e?.message || e);
    }
  }

  async function loadInto(id, urlPath) {
    const el = document.getElementById(id);
    if (!el) return false;

    const url = abs(urlPath);
    const reqUrl = url + (url.includes("?") ? "&" : "?") + "_pv=" + Date.now();
    const res = await fetch(reqUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`partial load failed: ${urlPath} (${res.status})`);

    // Force UTF-8 decoding to prevent mojibake when hosting sends wrong charset.
    const buf = await res.arrayBuffer();
    let html = new TextDecoder("utf-8").decode(buf);
    html = html.replace(/^\uFEFF/, "");
    el.innerHTML = html;
    return true;
  }

  async function mount() {
    try {
      ensureFavicon();
      ensureCss("/assets/css/footer.css");
      ensurePwaMeta();
      ensurePwaScript();
      ensureInAppGuardScript();

      await loadInto("siteHeader", "/partials/header.html");
      applyHeaderI18n();
      await loadInto("siteFooter", "/partials/footer.html");
      applyFooterI18n();
      ensureSupportChatScript();

      window.dispatchEvent(new CustomEvent("partials:loaded"));
      window.dispatchEvent(new CustomEvent("partials:mounted"));
    } catch (e) {
      console.warn("partials mount failed:", e?.message || e);
      window.dispatchEvent(new CustomEvent("partials:error", { detail: e }));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();


