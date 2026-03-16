Dragon Monster Sprite
=====================

코드상 type 이름 : dragon
Sprite file      : dragon_sprite.png
Config file      : dragon_config.json

Sprite Sheet 규격
-----------------
전체 크기 : 1536 x 1024 px
프레임 크기: 256 x 256 px
열 수(cols): 6
행 수(rows): 4

Animation Row 정의
------------------
Row 0 (y=0)    : idle    — 6 frames, 4 fps, loop
Row 1 (y=256)  : walk    — 6 frames, 8 fps, loop
Row 2 (y=512)  : attack  — 6 frames, 10 fps, one-shot
                 hit      — 앞 3 frames 재사용, 12 fps, one-shot
Row 3 (y=768)  : death   — 6 frames, 6 fps, one-shot
                 respawn  — 같은 row, 역 방향 효과 (코드에서 처리)

상태 → 애니메이션 매핑
---------------------
idle       → idle
chasing    → walk
return     → walk
attacking  → attack (one-shot → 복귀)
hit event  → hit   (one-shot → 복귀)
dead       → death (one-shot → 숨김)
respawning → respawn (one-shot → idle 복귀)

지도 표시
---------
displaySize : 80px (기존 몬스터 36px 대비 약 2.2배)
anchor      : bottom-center (발 기준)

전투 스펙 (game-server)
-----------------------
maxHp           : 300
aggroRangeM     : 25 m
attackRangeM    : 20 m
attackPower     : 25
attackCooldownMs: 1800 ms
respawnSeconds  : 60 s (테스트용 — 운영 시 300 이상 권장)
moveSpeed       : 0.8 m/s

TODO
----
- sprite sheet 시각 확인 후 row/frames 실측값으로 교정
- 브레스 이펙트 추가 시 attack row를 ranged attack용으로 별도 분리 고려
