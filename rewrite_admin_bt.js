const fs = require('fs');

let js = fs.readFileSync('assets/js/admin-approve.js', 'utf8');

// Insert BT element in the merchant UI
const targetUi = `<button class="btn btn-sm" type="button" data-act="approveMerchant" data-mid="\${esc(mid)}" data-feebps="\${feeBps}">수수료 설정</button>`;
const btBtnUi = `<button class="btn btn-sm" type="button" data-act="chargeBt" data-mid="\${esc(mid)}">🎟️ BT 충전</button>`;
if (!js.includes('data-act="chargeBt"')) {
    js = js.replace(targetUi, targetUi + '\n              ' + btBtnUi);
}

// Show BT Balance
const subUi = `<div class="sum-sub">\${esc([v.career, v.region, ownerEmail || ("uid:" + (v.ownerUid || "-"))].filter(Boolean).join(" · "))}</div>`;
const btSubUi = `<div class="sum-sub">BT 잔여량: <b style="color:#d946ef;">\${v.btBalance || 0} BT</b></div>`;
if (!js.includes('BT 잔여량:')) {
    js = js.replace(subUi, subUi + '\n            ' + btSubUi);
}

// Add the click listener
const listenerBlock = `if (act === "approveMerchant") {`;
const actBlock = `
    if (act === "chargeBt") {
      e.preventDefault();
      const mid = btn.dataset.mid;
      const amtStr = prompt("충전할 BT 개수를 입력하세요 (숫자만, 차감은 마이너스 입력):");
      if (!amtStr) return;
      const amt = Number(amtStr);
      if (!amt || isNaN(amt)) { alert("올바른 숫자를 입력하세요."); return; }
      
      try {
        const fn = httpsCallable(functions, "adminChargeBt");
        await fn({ merchantId: Number(mid), amount: amt });
        alert(amt + " BT가 성공적으로 충전되었습니다.");
        loadMerchants();
      } catch (err) {
        alert("충전 실패: " + err.message);
      }
      return;
    }
    `;
if (!js.includes('act === "chargeBt"')) {
    js = js.replace(listenerBlock, actBlock + listenerBlock);
}

fs.writeFileSync('assets/js/admin-approve.js', js, 'utf8');
console.log('Added Admin BT Charge UI');
