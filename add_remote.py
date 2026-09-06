import re

try:
    content = open('merchant-qr.html', 'r', encoding='utf-8').read()
    
    # We will insert a section right above </main>
    remote_bt_html = """
    <section class="section">
      <div class="card" style="box-shadow:0 4px 12px rgba(0,0,0,0.05); margin-bottom:20px;">
        <h2 class="card-title" style="margin-bottom:12px; font-size:1.1rem;"><i class="fa-solid fa-paper-plane me-2 text-primary"></i>원격(온라인) 결제 회원 BT 전송</h2>
        <p class="text-muted" style="font-size:0.9rem; margin-bottom:16px;">잘로페이, 현금이체 등 현장에 없는 회원에게 K-MOA 이메일과 결제금액을 입력하여 직접 BT를 전송할 수 있습니다.</p>
        
        <div class="form-group mb-3">
          <label class="form-label">회원(고객) 이메일</label>
          <input type="email" id="remoteUserEmail" class="form-input" placeholder="고객의 K-MOA 로그인 이메일 입력" autocomplete="off">
        </div>
        
        <div class="form-group mb-3">
          <label class="form-label">온라인 결제 금액 (VND)</label>
          <input type="number" id="remoteVndAmount" class="form-input" placeholder="예: 250000" autocomplete="off">
        </div>

        <button class="btn btn--primary" id="btnRemoteBtSend" style="width:100%; border-radius:12px; font-weight:600;"><i class="fa-solid fa-gift me-2"></i>BT 전송하기</button>
        <div id="remoteBtResult" style="margin-top:16px; font-weight:bold; text-align:center;"></div>
      </div>
    </section>
    """
    
    # Replace the closing </section> just before </main> with the new section + </main>
    # Find </main>
    idx = content.find('</main>')
    if idx != -1:
        content = content[:idx] + remote_bt_html + "\n</main>" + content[idx+len('</main>'):]
        
        with open('merchant-qr.html', 'w', encoding='utf-8') as f:
            f.write(content)
        print("merchant-qr.html updated with remote BT UI")
    else:
        print("Cannot find </main>")

except Exception as e:
    print(e)
