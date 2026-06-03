import os
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests as _req

from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup,
    MenuButtonWebApp, WebAppInfo,
)
from telegram.ext import (
    ApplicationBuilder, CommandHandler, CallbackQueryHandler,
    MessageHandler, ContextTypes, filters,
)

import sys
import firebase_admin
from firebase_admin import credentials, firestore

# Windows 콘솔 UTF-8 강제 (이모지 출력용)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── 필수 환경변수 검증 ────────────────────────────────────────────────────────
_REQUIRED = ["BOT_TOKEN", "FIREBASE_SERVICE_ACCOUNT"]
_missing  = [v for v in _REQUIRED if not os.environ.get(v)]
if _missing:
    print(f"[ERROR] 필수 환경변수 누락: {', '.join(_missing)}")
    print("Railway -> 봇 서비스 -> Variables 탭에서 설정하세요.")
    sys.exit(1)

# ── Firebase 초기화 ───────────────────────────────────────────────────────────
try:
    _sa_json = os.environ["FIREBASE_SERVICE_ACCOUNT"]
    _cred    = credentials.Certificate(json.loads(_sa_json))
    firebase_admin.initialize_app(_cred)
    _db      = firestore.client()
    print("[OK] Firebase 연결 성공")
except json.JSONDecodeError as e:
    print(f"[ERROR] FIREBASE_SERVICE_ACCOUNT JSON 파싱 실패: {e}")
    print("Railway Variables에서 JSON 전체를 정확히 붙여넣었는지 확인하세요.")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Firebase 초기화 실패: {e}")
    sys.exit(1)

BOT_TOKEN             = os.environ["BOT_TOKEN"]
HUB_URL               = "https://jump22.netlify.app/telegram.html"
TON_DEPOSIT_ADDRESS   = os.environ.get("TON_DEPOSIT_ADDRESS", "")
MEMBERSHIP_TON_PRICE  = float(os.environ.get("MEMBERSHIP_TON_PRICE", "5"))
TON_CENTER_API_KEY    = os.environ.get("TON_CENTER_API_KEY", "")
FREE_ENTRY_MAX        = 3
UTC7                  = timezone(timedelta(hours=7))
_executor             = ThreadPoolExecutor(max_workers=4)

# 유저별 상태 (txHash 입력 대기)
_user_state: dict = {}   # {telegram_user_id: 'awaiting_txhash'}

# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _today_utc7() -> str:
    return datetime.now(UTC7).strftime("%Y-%m-%d")

def _uid(tg_id: int) -> str:
    return f"tg_{tg_id}"

async def _run(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, lambda: fn(*args))

# ── Firestore 동기 함수 ────────────────────────────────────────────────────────

def _get_status(uid: str) -> dict:
    user_snap   = _db.collection("users").document(uid).get()
    player_snap = _db.collection("battle_players").document(uid).get()
    user        = user_snap.to_dict()   or {} if user_snap.exists   else {}
    player      = player_snap.to_dict() or {} if player_snap.exists else {}

    today   = _today_utc7()
    expiry  = user.get("coopMemberUntil", "")
    is_prem = bool(expiry and expiry >= today)

    days_left = 0
    if is_prem and expiry:
        exp_dt    = datetime.strptime(expiry, "%Y-%m-%d").replace(tzinfo=UTC7)
        days_left = max(0, (exp_dt.date() - datetime.now(UTC7).date()).days + 1)

    free_key  = f"freeEntry_{today}"
    free_used = player.get(free_key, 0)

    # TON 가격: membership_config 우선, 없으면 env var
    cfg_snap  = _db.collection("membership_config").document("pricing").get()
    ton_price = (cfg_snap.to_dict() or {}).get("tonPrice", MEMBERSHIP_TON_PRICE) if cfg_snap.exists else MEMBERSHIP_TON_PRICE

    return {
        "is_premium":  is_prem,
        "expires_at":  expiry or None,
        "days_left":   days_left,
        "free_used":   free_used,
        "free_left":   max(0, FREE_ENTRY_MAX - free_used) if is_prem else 0,
        "name":        user.get("displayName") or user.get("name") or "회원",
        "ton_price":   ton_price,
    }


def _activate(uid: str, payment_id: str, ton_amount: float, extra: dict = None) -> tuple:
    """정회원 활성화 + 결제 기록. (new_expiry, is_first) 반환."""
    user_ref  = _db.collection("users").document(uid)
    user_snap = user_ref.get()
    today     = _today_utc7()
    user      = user_snap.to_dict() or {} if user_snap.exists else {}

    expiry = user.get("coopMemberUntil", "")
    base   = (datetime.strptime(expiry, "%Y-%m-%d").replace(tzinfo=UTC7)
              if expiry and expiry >= today else datetime.now(UTC7))
    new_expiry = (base + timedelta(days=30)).strftime("%Y-%m-%d")
    is_first   = not user.get("memberFirstJoin")

    updates = {"coopMemberUntil": new_expiry, "updatedAt": firestore.SERVER_TIMESTAMP}
    if is_first:
        updates["memberFirstJoin"] = firestore.SERVER_TIMESTAMP
    user_ref.set(updates, merge=True)

    # 최초 가입: 레벨 4 지급
    if is_first:
        p_ref  = _db.collection("battle_players").document(uid)
        p_snap = p_ref.get()
        level  = (p_snap.to_dict() or {}).get("level", 1) if p_snap.exists else 1
        if level < 4:
            p_ref.set({"level": 4}, merge=True)

    # 결제 기록
    payment_doc = {
        "uid":               uid,
        "tonAmount":         ton_amount,
        "paymentId":         payment_id,
        "expiresAt":         new_expiry,
        "createdMonth":      new_expiry[:7],
        "isFirstMembership": is_first,
        "createdAt":         firestore.SERVER_TIMESTAMP,
    }
    if extra:
        payment_doc.update(extra)
    _db.collection("membership_payments").document(payment_id).set(payment_doc)

    return new_expiry, is_first


def _verify_and_activate_ton(uid: str, txhash: str) -> dict:
    """TON 트랜잭션 확인 후 정회원 활성화."""
    pay_id = f"ton_{txhash}"

    # 중복 체크
    dup = _db.collection("membership_payments").document(pay_id).get()
    if dup.exists:
        raise Exception("이미 처리된 트랜잭션입니다.")

    # TON Center API로 트랜잭션 조회
    headers = {"X-API-Key": TON_CENTER_API_KEY} if TON_CENTER_API_KEY else {}
    try:
        resp = _req.get(
            "https://toncenter.com/api/v3/transactions",
            params={"hash": txhash, "limit": 1},
            headers=headers,
            timeout=20,
        )
        resp.raise_for_status()
    except _req.exceptions.Timeout:
        raise Exception("TON API 타임아웃. 잠시 후 다시 시도해주세요.")
    except Exception as e:
        raise Exception(f"TON API 오류: {e}")

    data = resp.json()
    txs  = data.get("transactions", [])
    if not txs:
        raise Exception("트랜잭션을 찾을 수 없습니다. 블록체인 확인에 수 분이 걸릴 수 있습니다.")

    tx     = txs[0]
    in_msg = tx.get("in_msg", {})

    # 금액 확인 (nanoTON)
    value_nano    = int(in_msg.get("value") or 0)
    required_nano = int(MEMBERSHIP_TON_PRICE * 1_000_000_000)
    if value_nano < required_nano:
        actual = value_nano / 1_000_000_000
        raise Exception(f"금액 부족: {actual:.4f} TON 전송됨 (필요: {MEMBERSHIP_TON_PRICE} TON)")

    ton_received = value_nano / 1_000_000_000

    # 정회원 활성화
    new_expiry, is_first = _activate(uid, pay_id, ton_received, {
        "txHash":      txhash,
        "fromAddress": in_msg.get("source", ""),
        "paymentType": "ton",
    })

    _process_pending_referral(uid)
    return {"expiresAt": new_expiry, "isFirstMembership": is_first}


def _save_pending_referral(new_uid: str, referrer_uid: str):
    if new_uid == referrer_uid:
        return
    dup = _db.collection("membership_referrals").where("newUserUid", "==", new_uid).limit(1).get()
    if len(dup) > 0:
        return
    _db.collection("pending_referrals").document(new_uid).set({
        "referrerUid": referrer_uid,
        "newUserUid":  new_uid,
        "createdAt":   firestore.SERVER_TIMESTAMP,
    })


def _process_pending_referral(new_uid: str):
    pending = _db.collection("pending_referrals").document(new_uid).get()
    if not pending.exists:
        return
    data         = pending.to_dict() or {}
    referrer_uid = data.get("referrerUid")
    if not referrer_uid or referrer_uid == new_uid:
        return

    dup = _db.collection("membership_referrals").where("newUserUid", "==", new_uid).limit(1).get()
    if len(dup) > 0:
        return

    today    = _today_utc7()
    ref_snap = _db.collection("users").document(referrer_uid).get()
    if not ref_snap.exists:
        return
    expiry = (ref_snap.to_dict() or {}).get("coopMemberUntil", "")
    if not expiry or expiry < today:
        return

    _db.collection("battle_players").document(referrer_uid).set(
        {"gold": firestore.Increment(500)}, merge=True
    )
    _db.collection("membership_referrals").add({
        "referrerUid": referrer_uid,
        "newUserUid":  new_uid,
        "gpRewarded":  500,
        "status":      "rewarded",
        "createdAt":   firestore.SERVER_TIMESTAMP,
    })
    _db.collection("pending_referrals").document(new_uid).delete()

# ── 명령어 핸들러 ──────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = context.args or []
    uid  = _uid(update.effective_user.id)

    if args and args[0].startswith("REF"):
        await _run(_save_pending_referral, uid, args[0][3:])

    keyboard = [
        [InlineKeyboardButton("🎮 JUMP22 Game Hub", web_app=WebAppInfo(url=HUB_URL))],
        [
            InlineKeyboardButton("🗺️ Treasure Hunt",  url="https://jump22.netlify.app/merchants"),
            InlineKeyboardButton("🛹 Monster Race",   url="https://jump22.netlify.app/monsterrace"),
        ],
        [
            InlineKeyboardButton("🏹 Archery Hunt",   url="https://jump22.netlify.app/bow"),
            InlineKeyboardButton("🃏 Memory Game",    url="https://jump22.netlify.app/memory"),
        ],
        [InlineKeyboardButton("🏰 Monster Siege",    url="https://jump22.netlify.app/conquest")],
        [InlineKeyboardButton("⭐ 정회원 혜택 보기",  callback_data="membership_info")],
    ]
    await update.message.reply_text(
        "🎮 *JUMP22 Game Hub*\n\n"
        "From GPS Treasure Hunt to Monster Battles!\n"
        "Pick a game, earn GP, and exchange for Reward! 🚀",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def cmd_membership(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = _uid(update.effective_user.id)
    st  = await _run(_get_status, uid)
    await _send_membership_ui(update.message, st)


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if _user_state.pop(user_id, None):
        await update.message.reply_text("결제가 취소되었습니다.")


async def cmd_play(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, context)

# ── 콜백 핸들러 ───────────────────────────────────────────────────────────────

async def cb_membership_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = _uid(q.from_user.id)
    st  = await _run(_get_status, uid)
    await _send_membership_ui(q.message, st)


async def cb_buy_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q       = update.callback_query
    await q.answer()
    user_id = q.from_user.id
    uid     = _uid(user_id)
    st      = await _run(_get_status, uid)
    price   = st["ton_price"]

    # txHash 입력 대기 상태로 전환
    _user_state[user_id] = "awaiting_txhash"

    addr_display = f"`{TON_DEPOSIT_ADDRESS}`" if TON_DEPOSIT_ADDRESS else "_(주소 미설정 — 관리자에게 문의)_"

    text = (
        f"💎 *정회원 TON 결제*\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"💰 금액: `{price} TON`\n"
        f"📬 입금 주소:\n{addr_display}\n"
        f"━━━━━━━━━━━━━━━━━━\n\n"
        f"1️⃣ 위 주소로 정확히 *{price} TON* 전송\n"
        f"2️⃣ 전송 완료 후 *트랜잭션 해시*를 이 채팅에 붙여넣기\n\n"
        f"_해시는 TON 지갑 앱 → 거래 내역 → 해당 거래 상세에서 확인_\n\n"
        f"/cancel 로 취소"
    )
    await q.message.reply_text(text, parse_mode="Markdown")


async def cb_referral_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q        = update.callback_query
    await q.answer()
    uid      = _uid(q.from_user.id)
    bot_name = (await context.bot.get_me()).username
    link     = f"https://t.me/{bot_name}?start=REF{uid}"
    await q.message.reply_text(
        f"👥 *친구 초대 링크*\n\n`{link}`\n\n"
        "친구가 이 링크로 정회원 가입 시 *500 GP*를 드립니다!",
        parse_mode="Markdown",
    )

# ── 메시지 핸들러 (txHash 수신) ───────────────────────────────────────────────

async def handle_txhash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if _user_state.get(user_id) != "awaiting_txhash":
        return

    txhash = (update.message.text or "").strip()
    if len(txhash) < 20:
        return  # 너무 짧으면 무시

    _user_state.pop(user_id, None)
    uid = _uid(user_id)

    wait_msg = await update.message.reply_text("🔍 결제 확인 중... (최대 20초)")

    try:
        result    = await _run(_verify_and_activate_ton, uid, txhash)
        expiry    = result["expiresAt"]
        is_first  = result["isFirstMembership"]
        bot_name  = (await context.bot.get_me()).username
        invite    = f"https://t.me/{bot_name}?start=REF{uid}"

        text = (
            f"🎉 *정회원 활성화 완료!*\n\n"
            f"만료일: `{expiry}`\n"
            f"매일 무료 게임 입장 3회 활성화!\n"
        )
        if is_first:
            text += "🎮 레벨 4 부스트 적용!\n"
        text += f"\n👥 친구 초대 링크:\n`{invite}`"

        await wait_msg.delete()
        await update.message.reply_text(text, parse_mode="Markdown")

    except Exception as e:
        # 실패 시 재시도 허용
        _user_state[user_id] = "awaiting_txhash"
        await wait_msg.delete()
        await update.message.reply_text(
            f"❌ 확인 실패: {e}\n\n"
            "트랜잭션 해시를 다시 확인 후 전송하거나\n"
            "/cancel 로 취소하세요."
        )

# ── 공통 UI ───────────────────────────────────────────────────────────────────

async def _send_membership_ui(message, st: dict):
    price = st["ton_price"]
    if st["is_premium"]:
        text = (
            f"⭐ *Premium Member*\n"
            f"만료일: `{st['expires_at']}` (D-{st['days_left']})\n"
            f"오늘 무료 입장: {st['free_used']} / {FREE_ENTRY_MAX}회 사용"
        )
        keyboard = [
            [InlineKeyboardButton("🔄 30일 연장",       callback_data="buy_premium")],
            [InlineKeyboardButton("👥 친구 초대 링크",  callback_data="referral_link")],
        ]
    else:
        text = (
            "일반회원\n\n"
            "⭐ 정회원 혜택:\n"
            "• 매일 무료 게임 입장 3회\n"
            "• 정회원 전용 보물박스\n"
            "• 레벨 4 즉시 부스트 (최초 1회)\n"
            "• 친구 초대 500 GP 보상\n\n"
            f"가격: 💎 {price} TON / 30일"
        )
        keyboard = [
            [InlineKeyboardButton(
                f"💎 정회원 가입 ({price} TON)",
                callback_data="buy_premium",
            )],
        ]
    await message.reply_text(
        text, parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

# ── 봇 초기화 ─────────────────────────────────────────────────────────────────

async def _post_init(application):
    """봇 시작 시 Menu Button을 Game Hub Mini App으로 고정 설정."""
    await application.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="🎮 Game Hub",
            web_app=WebAppInfo(url=HUB_URL),
        )
    )

# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).post_init(_post_init).build()

    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("play",       cmd_play))
    app.add_handler(CommandHandler("membership", cmd_membership))
    app.add_handler(CommandHandler("cancel",     cmd_cancel))

    app.add_handler(CallbackQueryHandler(cb_membership_info, pattern="^membership_info$"))
    app.add_handler(CallbackQueryHandler(cb_buy_premium,     pattern="^buy_premium$"))
    app.add_handler(CallbackQueryHandler(cb_referral_link,   pattern="^referral_link$"))

    # 텍스트 메시지 → txHash 처리 (명령어 제외)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_txhash))

    print("✅ Bot is running (TON payment mode)...")
    app.run_polling()

if __name__ == "__main__":
    main()
