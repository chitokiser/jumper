#!/usr/bin/env node
// 서버 함수 배포 전 안전장치 (scripts/deploy-functions.ps1 이 먼저 실행 — Windows 에서 firebase predeploy 실행이 실패해 분리)
// 2026-10-17 예전 사본에서 함수 263개가 한꺼번에 배포돼 결제 BT 지급 등 최근 수정이 사라진 일을 막는다.
// - 이 폴더가 GitHub(origin/master) 최신과 같지 않으면 배포 중단
// - functions/ 안에 커밋 안 된 변경이 있으면 배포 중단
// 꼭 필요할 때만: PowerShell 에서 $env:ALLOW_STALE_DEPLOY="1" 후 배포
const { execSync } = require('child_process');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const stop = (msg) => {
  console.error(`\n[배포 중단] ${msg}\n`);
  process.exit(1);
};

if (process.env.ALLOW_STALE_DEPLOY === '1') {
  console.warn('[배포 안전장치] ALLOW_STALE_DEPLOY=1 — 검사를 건너뜁니다.');
  process.exit(0);
}

try {
  sh('git rev-parse --is-inside-work-tree');
} catch {
  stop('git 저장소가 아닌 폴더에서 배포하려고 합니다. jumper_v10 저장소에서 배포하세요.');
}

try {
  sh('git fetch -q origin master');
} catch {
  stop('GitHub 최신 상태를 확인할 수 없습니다 (git fetch 실패). 인터넷 연결을 확인하세요.');
}

const head = sh('git rev-parse HEAD');
const remote = sh('git rev-parse origin/master');
if (head !== remote) {
  const behind = sh('git rev-list --count HEAD..origin/master');
  const ahead = sh('git rev-list --count origin/master..HEAD');
  stop(`이 폴더가 GitHub 최신과 다릅니다 (뒤처짐 ${behind}개, 안 올린 커밋 ${ahead}개). git pull / git push 후 배포하세요.`);
}

const dirty = sh('git status --porcelain -- functions');
if (dirty) {
  stop(`functions/ 에 커밋 안 된 변경이 있습니다:\n${dirty}\n커밋·푸시 후 배포하세요.`);
}

console.log(`[배포 안전장치] 통과 — GitHub 최신(${head.slice(0, 7)})과 같습니다.`);
