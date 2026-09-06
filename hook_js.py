import re

try:
    content = open('assets/js/pages/merchant-qr.js', 'r', encoding='utf-8').read()
    
    js = """
// ── 원격 연결 ── //
const btnRemoteBtSend = $("btnRemoteBtSend");
if (btnRemoteBtSend) {
  btnRemoteBtSend.onclick = async () => {
    const email = $("remoteUserEmail")?.value.trim();
    const amountVal = Number($("remoteVndAmount")?.value);
    const resBox = $("remoteBtResult");
    if (!email) return alert("고객 이메일을 입력하세요!");
    if (!amountVal || amountVal < 10000) return alert("결제 금액은 최소 10,000 VND 이상이어야 합니다!");
    
    try {
        btnRemoteBtSend.disabled = true;
        btnRemoteBtSend.textContent = "전송 중...";
        const fn = httpsCallable(functions, "merchantSendBtDirect");
        const res = await fn({ customerEmail: email, amountVnd: amountVal });
        if (resBox) {
            resBox.style.color = "blue";
            resBox.innerHTML = `전송 성공! ${res.data.customerEmail}님에게 ${res.data.btIssued} BT가 지급되었습니다.`;
        }
        $("remoteUserEmail").value = "";
        $("remoteVndAmount").value = "";
    } catch(err) {
        if (resBox) {
            resBox.style.color = "red";
            resBox.innerText = "오류: " + err.message;
        }
    } finally {
        btnRemoteBtSend.disabled = false;
        btnRemoteBtSend.innerHTML = `<i class="fa-solid fa-gift me-2"></i>BT 전송하기`;
    }
  };
}
"""
    if "btnRemoteBtSend" not in content:
        content += "\n" + js
        with open('assets/js/pages/merchant-qr.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Hooked JS!")
except Exception as e:
    print(e)
