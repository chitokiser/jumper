const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const heroContentRegex = /<div class="town-hero-inner hero-content">[\s\S]*?<\/div>\s*<style>/i;
const newHeroContent = `<div class="town-hero-inner hero-content">
      <h1 class="town-title"
        style="font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 900; background: linear-gradient(to right, #facc15, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));">
        K-MOA ALLIANCE
      </h1>
      <p class="town-subtitle"
        style="font-size: clamp(1rem, 2.5vw, 1.4rem); color: #fff; max-width: 600px; margin: 0 auto 30px auto; line-height: 1.6; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">
        세계 최초의 온·오프라인 실물 경제 통합 포인트 플랫폼!<br>
        가맹점에서 결제하고, 매일매일 잭팟 당첨의 주인공이 되어보세요.
      </p>
      <div class="hero-actions" style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
        <a class="btn hero-cta-btn" href="/merchant-qr.html"
          style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border:none; padding: 14px 28px; font-weight: 700; border-radius: 99px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);">
          💸 내 가맹점 QR 띄우기
        </a>
        <a class="btn hero-cta-btn" href="/find_merchants.html"
          style="background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; border:none; padding: 14px 28px; font-weight: 700; border-radius: 99px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.4);">
          🗺️ 보물 지도 열기
        </a>
        <a class="btn hero-cta-btn" href="/mypage.html"
          style="background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 14px 28px; font-weight: 700; border-radius: 99px; backdrop-filter: blur(10px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer;">
          🎁 내 포인트/보상 확인
        </a>
      </div>
    </div>
    <style>`;
html = html.replace(heroContentRegex, newHeroContent);
fs.writeFileSync('index.html', html, 'utf8');
console.log('Hero updated');
