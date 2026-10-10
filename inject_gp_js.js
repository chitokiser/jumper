const fs = require('fs');
const cheerio = require('cheerio');

let js = fs.readFileSync('assets/js/pages/mypage.js', 'utf8');

// I will inject the GP -> Point exchange logic into onSnapshot callback and append a click listener.
// onSnapshot runs at line 129
const injectionPoint = 'if (elPoint) {';
const gpLogic = `
  const elGpDisp = document.getElementById("gpBalanceDisplay");
  const elGpLv = document.getElementById("gpUserLevelDisplay");
  const elGpBtn = document.getElementById("btnConvertGpToPoint");

  const gpBal = updatedD.gold || 0;
  const userLv = updatedD.level || 1;

  if (elGpDisp) elGpDisp.textContent = gpBal.toLocaleString("ko-KR") + " GP";
  if (elGpLv) elGpLv.textContent = "Level: " + userLv;

  if (elGpBtn) {
    elGpBtn.onclick = async () => {
      if (gpBal < 10) {
        alert("최소 10 GP 이상이어야 전환 가능합니다.");
        return;
      }
      if (!confirm("GP를 Point로 전환하시겠습니까?")) return;

      const convertedPoint = Math.floor((gpBal * userLv) / 10);
      try {
        elGpBtn.disabled = true;
        elGpBtn.textContent = "전환 중...";
        
        await updateDoc(doc(db, "users", uid), {
          gold: 0,
          pointBalance: increment(convertedPoint),
          pointBalanceVnd: increment(convertedPoint * 17) // Assuming 1 P = 17 VND if needed, but Point might be enough
        });

        // Write history for point conversion
        const pHisRef = collection(db, "pointHistories");
        await addDoc(pHisRef, {
          uid: uid,
          displayName: updatedD.displayName || "익명",
          amount: convertedPoint,
          type: "GP Exchange",
          desc: gpBal.toLocaleString() + " GP 전환 (Lv." + userLv + ")",
          createdAt: serverTimestamp()
        });

        alert("성공적으로 " + convertedPoint.toLocaleString() + " Point 로 전환되었습니다!");
      } catch (e) {
        console.error(e);
        alert("전환 중 오류가 발생했습니다.");
      } finally {
        elGpBtn.disabled = false;
        elGpBtn.textContent = "전환하기 (최소 10 GP 이상)";
      }
    };
  }
`;

js = js.replace(injectionPoint, gpLogic + '\n  ' + injectionPoint);
fs.writeFileSync('assets/js/pages/mypage.js', js);
console.log('Injected conversion logic');
