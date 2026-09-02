const fs = require('fs');
let html = fs.readFileSync('family-register.html', 'utf8');

html = html.replace(
    '<p style="font-weight:600; margin-bottom:10px;">업종/카테고리 · 활동지역 · 소개 수정</p>',
    `<p style="font-weight:600; margin-bottom:10px;">상호 · 업종 · 활동지역 · 소개 수정</p>
          <label class="field">
            <span>상호 / 가게명 <em class="req">*</em></span>
            <input type="text" id="editMerchantName" maxlength="50" />
          </label>`
);

fs.writeFileSync('family-register.html', html, 'utf8');

let js = fs.readFileSync('assets/js/pages/family-register.js', 'utf8');

js = js.replace(
    'const inputCareer = $("editMerchantCareer");',
    `const inputName   = $("editMerchantName");
  const inputCareer = $("editMerchantCareer");`
);

js = js.replace(
    'btnToggle?.addEventListener("click", () => {',
    `btnToggle?.addEventListener("click", () => {
    if (inputName)   inputName.value   = merchantData.name || merchantName || "";`
);

js = js.replace(
    'const career = (inputCareer?.value || "").trim();',
    `const name   = (inputName?.value   || "").trim();
    const career = (inputCareer?.value || "").trim();`
);

js = js.replace(
    'if (!career) {',
    `if (!name) {
      if (editMsg) { editMsg.textContent = "가게명/상호를 입력해 주세요."; editMsg.style.color = "var(--danger, #e53e3e)"; }
      return;
    }
    if (!career) {`
);

js = js.replace(
    'await updateDoc(doc(db, "merchants", _merchantDocId), {',
    `await updateDoc(doc(db, "merchants", _merchantDocId), { name,`
);

js = js.replace(
    'merchantData.career = career;',
    `merchantData.name = name;
      merchantName = name;
      merchantData.career = career;`
);

js = js.replace(
    'if (careerEl) careerEl.textContent = career || "-";',
    `if (nameEl)   nameEl.textContent   = name   || "-";
      if (careerEl) careerEl.textContent = career || "-";`
);

fs.writeFileSync('assets/js/pages/family-register.js', js, 'utf8');
console.log('Merchant name modifier injected.');
