import re

def optimize_ar_scan():
    with open('assets/js/pages/ar-scan.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Remove playSonarPing and its logic from renderAR
    # We will just stub playSonarPing so it does nothing, and remove its invocation
    content = content.replace("function playSonarPing(dist, claimR) {", "function playSonarPing(dist, claimR) { return; // OPTIMIZED OUT")
    
    # 2. Disable shadowBlur and shadowColor in renderAR
    content = re.sub(r'arCtx\.shadowColor\s*=\s*[^;]+;', '// arCtx.shadowColor optimized out;', content)
    content = re.sub(r'arCtx\.shadowBlur\s*=\s*\d+;', '// arCtx.shadowBlur optimized out;', content)
    
    # 3. Simplify radial gradient for lock-on glow (just use solid color with low alpha)
    glow_str_old = """      const grad = arCtx.createRadialGradient(screenX, screenY, size*0.2, screenX, screenY, size*1.1);
      grad.addColorStop(0, glowColor);
      grad.addColorStop(1, 'transparent');
      arCtx.fillStyle = grad;"""
    glow_str_new = """      arCtx.fillStyle = glowColor;"""
    content = content.replace(glow_str_old, glow_str_new)
    
    # 4. Remove drawVignette completely to save screen-fill draw calls
    content = content.replace("if (claimableVisible > 0) drawVignette(W, H, now);", "// Vignette optimized out")

    with open('assets/js/pages/ar-scan.js', 'w', encoding='utf-8') as f:
        f.write(content)

optimize_ar_scan()
