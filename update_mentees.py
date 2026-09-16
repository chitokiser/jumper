import re
try:
    content = open('assets/js/pages/mypage.js', 'r', encoding='utf-8').read()
    match = re.search(r'const rows = mentees\.map.*?join\(""\);', content, re.DOTALL)
    if match:
        print(match.group())
        
        # We want to show generatedForMentor
        replacement = """const rows = mentees.map(m => {
      const addr = m.walletAddress ? m.walletAddress.substring(0,6) + "..." + m.walletAddress.slice(-4) : "";
      const dateStr = m.registeredAt ? new Date(m.registeredAt).toLocaleDateString() : "";
      const earned = m.generatedForMentor || 0;
      return `
      <div class="fx-row align-center justify-between" style="border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:8px;">
        <div class="fx-col gap-1">
          <span style="font-weight:600;">${m.name}</span>
          <span class="mono muted" style="font-size:0.82em;">${addr} | ${dateStr}</span>
        </div>
        <div class="text-right">
          <span style="font-weight:600; color:var(--primary-color);">+${earned.toLocaleString()} P</span>
          <div style="font-size:0.75rem; color:#888;">지급 누적</div>
        </div>
      </div>`;
    }).join("");
"""
        
        content = content.replace(match.group(), replacement)
        with open('assets/js/pages/mypage.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated mentees UI!")
except Exception as e:
    print(e)
