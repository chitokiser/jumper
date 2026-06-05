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

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── 환경변수 검증 ─────────────────────────────────────────────────────────────
_REQUIRED = ["BOT_TOKEN", "FIREBASE_SERVICE_ACCOUNT"]
_missing  = [v for v in _REQUIRED if not os.environ.get(v)]
if _missing:
    print(f"[ERROR] Missing env vars: {', '.join(_missing)}")
    sys.exit(1)

# ── Firebase 초기화 ───────────────────────────────────────────────────────────
try:
    _sa_json = os.environ["FIREBASE_SERVICE_ACCOUNT"]
    _cred    = credentials.Certificate(json.loads(_sa_json))
    firebase_admin.initialize_app(_cred)
    _db      = firestore.client()
    print("[OK] Firebase connected")
except json.JSONDecodeError as e:
    print(f"[ERROR] FIREBASE_SERVICE_ACCOUNT JSON parse failed: {e}")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Firebase init failed: {e}")
    sys.exit(1)

BOT_TOKEN             = os.environ["BOT_TOKEN"]
HUB_URL               = "https://jump22.netlify.app/telegram.html"
TON_DEPOSIT_ADDRESS   = os.environ.get("TON_DEPOSIT_ADDRESS", "")
MEMBERSHIP_TON_PRICE  = float(os.environ.get("MEMBERSHIP_TON_PRICE", "5"))
TON_CENTER_API_KEY    = os.environ.get("TON_CENTER_API_KEY", "")
FUNCTIONS_BASE_URL    = os.environ.get("FUNCTIONS_BASE_URL", "")
UTC7                  = timezone(timedelta(hours=7))
_executor             = ThreadPoolExecutor(max_workers=4)
DAILY_GP_TOPUP        = 3500
TOPUP_THRESHOLD       = 1000
DEFAULT_MENTOR_ADDR   = "0xc662c3B58bE7345DE30dd8188B2Acc977943186A"

_user_state: dict = {}   # {telegram_user_id: 'awaiting_txhash'}

# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _today_utc7() -> str:
    return datetime.now(UTC7).strftime("%Y-%m-%d")

def _uid(tg_id: int) -> str:
    return f"tg_{tg_id}"

async def _run(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, lambda: fn(*args))

# ── Firestore ────────────────────────────────────────────────────────────────

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

    topup_key     = f"dailyTopup_{today}"
    topup_claimed = bool(player.get(topup_key, False))
    current_gp    = player.get("gold", 0)

    cfg_snap  = _db.collection("membership_config").document("pricing").get()
    ton_price = (cfg_snap.to_dict() or {}).get("tonPrice", MEMBERSHIP_TON_PRICE) if cfg_snap.exists else MEMBERSHIP_TON_PRICE

    return {
        "is_premium":     is_prem,
        "expires_at":     expiry or None,
        "days_left":      days_left,
        "current_gp":     current_gp,
        "topup_claimed":  topup_claimed,
        "topup_eligible": is_prem and not topup_claimed and current_gp <= TOPUP_THRESHOLD,
        "name":           user.get("displayName") or user.get("name") or "Member",
        "ton_price":      ton_price,
    }


def _get_user_wallet(uid: str):
    """수탁 지갑 보유 여부 확인. encryptedKey가 있는 경우만 반환."""
    try:
        snap = _db.collection("users").document(uid).get()
        if snap.exists:
            wallet = (snap.to_dict() or {}).get("wallet", {})
            if wallet.get("encryptedKey"):
                return wallet
    except Exception:
        pass
    return None


def _get_auto_referrers() -> list:
    """autoReferrers 컬렉션에서 활성 멘토 목록 반환 (최대 4개)."""
    try:
        snap = _db.collection("autoReferrers").where("active", "==", True).get()
        result = []
        for doc in snap:
            data = doc.to_dict() or {}
            addr = data.get("walletAddress", "")
            name = data.get("name") or data.get("displayName") or ""
            if addr:
                label = name or (addr[:6] + "..." + addr[-4:])
                result.append({"address": addr, "label": label})
        return result[:4]
    except Exception:
        return []


def _call_telegram_register(uid: str, mentor_address: str) -> dict:
    """Cloud Function telegramRegister 호출. 지갑 생성 + 온체인 등록."""
    if not FUNCTIONS_BASE_URL:
        raise Exception("FUNCTIONS_BASE_URL 환경변수가 설정되지 않았습니다")
    url = f"{FUNCTIONS_BASE_URL}/telegramRegister"
    resp = _req.post(
        url,
        json={"uid": uid, "mentorAddress": mentor_address},
        headers={"X-Bot-Token": BOT_TOKEN},
        timeout=90,
    )
    if not resp.ok:
        try:
            err_msg = resp.json().get("error") or f"HTTP {resp.status_code}"
        except Exception:
            err_msg = f"HTTP {resp.status_code}"
        raise Exception(err_msg)
    return resp.json()


def _activate(uid: str, payment_id: str, ton_amount: float, extra: dict = None) -> tuple:
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

    if is_first:
        p_ref  = _db.collection("battle_players").document(uid)
        p_snap = p_ref.get()
        level  = (p_snap.to_dict() or {}).get("level", 1) if p_snap.exists else 1
        if level < 4:
            p_ref.set({"level": 4}, merge=True)

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
    pay_id = f"ton_{txhash}"

    dup = _db.collection("membership_payments").document(pay_id).get()
    if dup.exists:
        raise Exception("이미 처리된 트랜잭션입니다. / Transaction already processed.")

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
        raise Exception("TON API 타임아웃 — 잠시 후 다시 시도하세요.\nTON API timeout — please retry.")
    except Exception as e:
        raise Exception(f"TON API 오류 / error: {e}")

    data = resp.json()
    txs  = data.get("transactions", [])
    if not txs:
        raise Exception(
            "트랜잭션을 찾을 수 없습니다. 수 분 후 다시 시도하세요.\n"
            "Transaction not found. Please retry in a few minutes."
        )

    tx     = txs[0]
    in_msg = tx.get("in_msg", {})

    # W5/스마트 컨트랙트 지갑: in_msg.value가 null이면 out_msgs에서 금액 탐색
    value_nano = int(in_msg.get("value") or 0)
    sender     = in_msg.get("source") or ""
    if value_nano == 0:
        for out in tx.get("out_msgs", []):
            v = int(out.get("value") or 0)
            if v > 0:
                value_nano = v
                sender     = tx.get("account", sender)
                break

    required_nano = int(MEMBERSHIP_TON_PRICE * 1_000_000_000)
    if value_nano < required_nano:
        actual = value_nano / 1_000_000_000
        raise Exception(
            f"금액 부족 / Insufficient amount: {actual:.4f} TON sent "
            f"(required: {MEMBERSHIP_TON_PRICE} TON)"
        )

    ton_received = value_nano / 1_000_000_000

    new_expiry, is_first = _activate(uid, pay_id, ton_received, {
        "txHash":      txhash,
        "fromAddress": sender,
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

# ── 명령어 핸들러 ─────────────────────────────────────────────────────────────

async def cmd_chatid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """그룹/채널 chat_id 확인 — ANNOUNCE_GROUP_ID 설정용"""
    chat = update.effective_chat
    await update.message.reply_text(
        f"📋 Chat ID: <code>{chat.id}</code>\n"
        f"Type: {chat.type}\n"
        f"Title: {chat.title or chat.username or '(private)'}",
        parse_mode="HTML"
    )

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args    = context.args or []
    uid     = _uid(update.effective_user.id)
    is_group = update.effective_chat.type in ("group", "supergroup")

    if args and args[0].startswith("REF"):
        await _run(_save_pending_referral, uid, args[0][3:])

    try:
        if is_group:
            # 그룹에서는 web_app 버튼이 BadRequest를 유발하므로 DM 유도 메시지만 전송
            bot_name = (await context.bot.get_me()).username
            keyboard = [[
                InlineKeyboardButton("🎮 JumpDAO 시작하기 / Open Bot", url=f"https://t.me/{bot_name}?start=hi"),
            ]]
            await update.message.reply_text(
                "*JumpDAO*\n\n"
                "게임포인트 ⇔ Toncoin & USDT 교환이 가능한 검증된 코인 게임 허브입니다.\n"
                "_A verified game hub where Game Points ⇔ Toncoin & USDT can be exchanged._\n\n"
                "👇 아래 버튼을 눌러 봇 개인 채팅에서 시작하세요!\n"
                "_Tap the button below to start in a private chat with the bot!_",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        keyboard = [
            [InlineKeyboardButton("🎮 Game Hub", web_app=WebAppInfo(url=HUB_URL))],
            [InlineKeyboardButton("📝 회원가입 / Register (1000 게임코인 에어드랍)", callback_data="register_check")],
            [
                InlineKeyboardButton("🗺️ Treasure Hunt",  url="https://jump22.netlify.app/treasure.html"),
                InlineKeyboardButton("🏎️ Monster Racing",  url="https://jump22.netlify.app/monsterrace.html"),
            ],
            [
                InlineKeyboardButton("🏹 Archery Hunt",   url="https://jump22.netlify.app/bow.html"),
                InlineKeyboardButton("🃏 Speed Memory",   url="https://jump22.netlify.app/memory.html"),
            ],
            [InlineKeyboardButton("🏰 Monster Defense",   url="https://jump22.netlify.app/conquest.html")],
            [InlineKeyboardButton("⭐ 정회원 혜택 / Premium Benefits", callback_data="membership_info")],
        ]
        await update.message.reply_text(
            "*JumpDAO*\n\n"
            "게임포인트 ⇔ Toncoin & USDT 교환이 가능한\n"
            "검증된 코인 게임 허브입니다.\n\n"
            "_A verified game hub where_\n"
            "_Game Points ⇔ Toncoin & USDT can be exchanged_",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    except Exception as e:
        print(f"[ERROR] cmd_start: {e}")


async def cmd_membership(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = _uid(update.effective_user.id)
    try:
        st = await _run(_get_status, uid)
        await _send_membership_ui(update.message, st)
    except Exception as e:
        print(f"[ERROR] cmd_membership: {e}")
        await update.message.reply_text(
            "❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n"
            "_An error occurred. Please try again later._",
            parse_mode="Markdown",
        )


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if _user_state.pop(user_id, None):
        await update.message.reply_text(
            "결제가 취소되었습니다.\nPayment cancelled."
        )


async def cmd_play(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, context)

# ── 콜백 핸들러 ──────────────────────────────────────────────────────────────

async def cb_membership_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = _uid(q.from_user.id)
    try:
        st = await _run(_get_status, uid)
        await _send_membership_ui(q.message, st)
    except Exception as e:
        print(f"[ERROR] cb_membership_info: {e}")
        await q.message.reply_text(
            "❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n"
            "_An error occurred. Please try again later._",
            parse_mode="Markdown",
        )


async def cb_buy_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q       = update.callback_query
    await q.answer()
    user_id = q.from_user.id
    uid     = _uid(user_id)

    try:
        # 수탁 지갑 미보유 시 회원가입 먼저 안내
        wallet = await _run(_get_user_wallet, uid)
        if not wallet:
            await q.message.reply_text(
                "⚠️ *회원가입이 필요합니다 / Registration required*\n\n"
                "정회원 업그레이드 전에 먼저 회원가입(지갑 생성)을 완료해주세요.\n"
                "_Please complete registration before upgrading to Premium._",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("📝 회원가입 / Register", callback_data="register_check"),
                ]]),
            )
            return

        st      = await _run(_get_status, uid)
        price   = st["ton_price"]

        _user_state[user_id] = "awaiting_txhash"

        addr_display = f"`{TON_DEPOSIT_ADDRESS}`" if TON_DEPOSIT_ADDRESS else "_(주소 미설정 — 관리자 문의 / address not set — contact admin)_"

        text = (
            f"💎 *정회원 TON 결제 / Premium TON Payment*\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"💰 금액 / Amount: `{price} TON`\n"
            f"📬 입금 주소 / Deposit address:\n{addr_display}\n"
            f"━━━━━━━━━━━━━━━━━━\n\n"
            f"1️⃣ 위 주소로 정확히 *{price} TON* 전송\n"
            f"    _Send exactly *{price} TON* to the address above_\n\n"
            f"2️⃣ 전송 후 *트랜잭션 해시*를 이 채팅에 붙여넣기\n"
            f"    _Paste the *transaction hash* into this chat_\n\n"
            f"_해시: TON 지갑 앱 → 거래 내역 → 해당 거래 상세_\n"
            f"_Hash: TON wallet → Transaction history → Details_\n\n"
            f"/cancel 로 취소 / to abort"
        )
        await q.message.reply_text(text, parse_mode="Markdown")
    except Exception as e:
        print(f"[ERROR] cb_buy_premium: {e}")
        await q.message.reply_text(
            "❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n"
            "_An error occurred. Please try again later._",
            parse_mode="Markdown",
        )


async def cb_referral_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q        = update.callback_query
    await q.answer()
    try:
        uid      = _uid(q.from_user.id)
        bot_name = (await context.bot.get_me()).username
        link     = f"https://t.me/{bot_name}?start=REF{uid}"
        await q.message.reply_text(
            f"👥 *친구 초대 링크 / Referral Link*\n\n"
            f"`{link}`\n\n"
            f"이 링크로 친구가 정회원 가입 시 *500 GP* 지급!\n"
            f"_When a friend joins Premium via this link, you get *500 GP*!_",
            parse_mode="Markdown",
        )
    except Exception as e:
        print(f"[ERROR] cb_referral_link: {e}")
        await q.message.reply_text(
            "❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n"
            "_An error occurred. Please try again later._",
            parse_mode="Markdown",
        )


async def cb_register_check(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """회원가입 버튼 → 지갑 보유 여부 확인 후 멘토 선택 또는 이미 가입 안내."""
    q = update.callback_query
    await q.answer()
    uid = _uid(q.from_user.id)

    try:
        wallet = await _run(_get_user_wallet, uid)

        if wallet:
            addr  = wallet.get("address", "")
            short = addr[:8] + "..." + addr[-6:] if addr else "?"
            await q.message.reply_text(
                f"✅ *이미 가입된 계정입니다 / Already registered*\n"
                f"지갑 / Wallet: `{short}`\n\n"
                f"정회원 업그레이드를 진행하세요.\n"
                f"_Proceed to Premium upgrade._",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("⭐ 정회원 업그레이드 / Go Premium", callback_data="membership_info"),
                ]]),
            )
            return

        # 멘토 목록 조회
        referrers = await _run(_get_auto_referrers)
        keyboard  = []
        for r in referrers:
            keyboard.append([InlineKeyboardButton(
                f"👤 {r['label']}", callback_data=f"select_mentor_{r['address']}"
            )])
        keyboard.append([InlineKeyboardButton(
            "🏠 기본 멘토 / Default Mentor",
            callback_data=f"select_mentor_{DEFAULT_MENTOR_ADDR}",
        )])

        await q.message.reply_text(
            "👤 *멘토를 선택하세요 / Select a Mentor*\n\n"
            "멘토는 추천인으로 등록되며 추후 변경이 어렵습니다.\n"
            "_Mentor is your referrer and cannot be easily changed later._",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    except Exception as e:
        print(f"[ERROR] cb_register_check: {e}")
        await q.message.reply_text(
            "❌ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n"
            "_An error occurred. Please try again later._",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("🔄 다시 시도 / Retry", callback_data="register_check"),
            ]]),
        )


async def cb_select_mentor(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """멘토 선택 → Cloud Function telegramRegister 호출 → 지갑 생성 + 온체인 등록."""
    q = update.callback_query
    await q.answer()
    uid            = _uid(q.from_user.id)
    mentor_address = q.data[len("select_mentor_"):]

    # 처리 중 메시지 — edit_text로 결과를 덮어쓰므로 delete 불필요
    wait_msg = await q.message.reply_text(
        "⏳ *[1/3] 지갑 생성 중... / Creating wallet...*\n"
        "잠시만 기다려주세요 (최대 90초)\n"
        "_Please wait (up to 90 sec)_",
        parse_mode="Markdown",
    )

    async def _edit(text, keyboard=None):
        """wait_msg를 결과 메시지로 교체. 실패해도 새 메시지로 재시도."""
        markup = InlineKeyboardMarkup(keyboard) if keyboard else None
        try:
            await wait_msg.edit_text(text, parse_mode="Markdown", reply_markup=markup)
        except Exception:
            await q.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)

    try:
        result     = await _run(_call_telegram_register, uid, mentor_address)
        address    = result.get("address", "")
        created    = result.get("created", False)
        registered = result.get("registered", False)
        join_bonus = result.get("joinBonus", False)

        if not created:
            short = address[:8] + "..." + address[-6:] if address else "?"
            await _edit(
                f"✅ *이미 가입된 계정입니다 / Already registered*\n"
                f"지갑 / Wallet: `{short}`",
                [[InlineKeyboardButton("⭐ 정회원 업그레이드 / Go Premium", callback_data="membership_info")]],
            )
            return

        chain_line = (
            "✅ [3/3] 온체인 등록 완료 / On-chain registered\n"
            if registered else
            "⏳ [3/3] 온체인 등록 진행 중 (자동 완료 예정)\n"
            "    _On-chain registration in progress (auto-complete)_\n"
        )
        bonus_line = "🎁 *1,000 GP* 에어드랍 지급 완료! / *1,000 GP* airdrop credited!\n" if join_bonus else ""
        await _edit(
            f"🎉 *가입 완료! / Registration Complete!*\n\n"
            f"💼 지갑 / Wallet: `{address}`\n"
            f"{chain_line}"
            f"{bonus_line}\n"
            f"이제 정회원 업그레이드를 진행하세요!\n"
            f"_Proceed to Premium upgrade!_",
            [[InlineKeyboardButton("⭐ 정회원 가입 / Join Premium", callback_data="membership_info")]],
        )

    except Exception as e:
        print(f"[ERROR] cb_select_mentor: {e}")
        err_msg = str(e)
        if "timeout" in err_msg.lower() or "timed out" in err_msg.lower():
            err_msg = "서버 응답 시간 초과 / Server timeout — 잠시 후 다시 시도하세요"
        await _edit(
            f"❌ *가입 실패 / Registration failed*\n\n"
            f"{err_msg}\n\n"
            "잠시 후 다시 시도하거나 고객센터에 문의하세요.\n"
            "_Please retry later or contact support._",
            [[InlineKeyboardButton("🔄 다시 시도 / Retry", callback_data="register_check")]],
        )

# ── 메시지 핸들러 (txHash 수신) ──────────────────────────────────────────────

async def handle_txhash(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if _user_state.get(user_id) != "awaiting_txhash":
        return

    txhash = (update.message.text or "").strip()
    if len(txhash) < 20:
        return

    _user_state.pop(user_id, None)
    uid = _uid(user_id)

    wait_msg = await update.message.reply_text(
        "🔍 *결제 확인 중... / Verifying payment...*\n"
        "잠시만 기다려주세요 (최대 20초) / _Please wait (up to 20 sec)_",
        parse_mode="Markdown",
    )

    async def _edit_pay(text, keyboard=None):
        markup = InlineKeyboardMarkup(keyboard) if keyboard else None
        try:
            await wait_msg.edit_text(text, parse_mode="Markdown", reply_markup=markup)
        except Exception:
            await update.message.reply_text(text, parse_mode="Markdown", reply_markup=markup)

    try:
        result    = await _run(_verify_and_activate_ton, uid, txhash)
        expiry    = result["expiresAt"]
        is_first  = result["isFirstMembership"]
        bot_name  = (await context.bot.get_me()).username
        invite    = f"https://t.me/{bot_name}?start=REF{uid}"

        text = (
            f"🎉 *정회원 활성화 완료! / Premium Activated!*\n\n"
            f"✅ 결제 확인 완료 / Payment verified\n"
            f"만료일 / Expires: `{expiry}`\n"
            f"🎁 매일 3,500 GP 충전 활성화 (GP 1,000 이하 시)\n"
            f"_Daily 3,500 GP top-up activated (when GP ≤ 1,000)_\n"
        )
        if is_first:
            text += "🎮 레벨 4 부스트 적용! / Level 4 boost applied!\n"
        text += f"\n👥 친구 초대 링크 / Referral link:\n`{invite}`"

        await _edit_pay(text)

    except Exception as e:
        _user_state[user_id] = "awaiting_txhash"
        print(f"[ERROR] handle_txhash: {e}")
        await _edit_pay(
            f"❌ *확인 실패 / Verification failed*\n\n"
            f"{e}\n\n"
            "트랜잭션 해시를 다시 확인 후 전송하거나\n"
            "_Please check the hash and try again, or_\n"
            "/cancel 로 취소 / to abort"
        )

# ── 공통 UI ───────────────────────────────────────────────────────────────────

async def _send_membership_ui(message, st: dict):
    price = st["ton_price"]
    if st["is_premium"]:
        gp = st.get("current_gp", 0)
        if st.get("topup_claimed"):
            topup_line = "✅ 오늘 3,500 GP 충전 완료 / Today's top-up claimed"
        elif gp > TOPUP_THRESHOLD:
            topup_line = f"🟡 GP {gp:,} — 1,000 초과로 충전 불가 / GP above 1,000, top-up unavailable"
        else:
            topup_line = "🎁 3,500 GP 충전 가능! Game Hub에서 수령\n_3,500 GP available! Claim in Game Hub_"

        text = (
            f"⭐ *정회원 / Premium Member*\n"
            f"만료 / Expires: `{st['expires_at']}` (D-{st['days_left']})\n\n"
            f"💰 보유 GP / Current GP: `{gp:,}`\n"
            f"{topup_line}"
        )
        keyboard = [
            [InlineKeyboardButton("🔄 30일 연장 / Extend 30 days", callback_data="buy_premium")],
            [InlineKeyboardButton("👥 친구 초대 링크 / Referral link", callback_data="referral_link")],
        ]
    else:
        text = (
            "일반회원 / Free Member\n\n"
            "⭐ *정회원 혜택 / Premium Benefits:*\n"
            "• 🎁 매일 게임코인 3,500 GP 충전\n"
            "    _(GP 1,000 이하일 때만)_\n"
            "    _Daily 3,500 GP top-up (when GP ≤ 1,000)_\n"
            "• 정회원 전용 보물박스 / Exclusive treasure boxes\n"
            "• 레벨 4 즉시 부스트 (최초 1회)\n"
            "    _Instant Level 4 boost (first time only)_\n"
            "• 친구 초대 500 GP 보상\n"
            "    _500 GP reward per referral_\n\n"
            f"가격 / Price: 💎 {price} TON / 30일 (days)"
        )
        keyboard = [
            [InlineKeyboardButton(
                f"💎 정회원 가입 / Join Premium ({price} TON)",
                callback_data="buy_premium",
            )],
        ]
    await message.reply_text(
        text, parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

# ── 봇 초기화 ─────────────────────────────────────────────────────────────────

async def error_handler(_update, context: ContextTypes.DEFAULT_TYPE):
    import telegram.error as tg_err
    if isinstance(context.error, tg_err.Conflict):
        print("[WARN] Conflict: previous instance still running, ignoring...")
        return
    print(f"[ERROR] Unhandled: {context.error}")


async def _post_init(application):
    await asyncio.sleep(3)
    try:
        await application.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="🎮 Game Hub",
                web_app=WebAppInfo(url=HUB_URL),
            )
        )
    except Exception:
        pass

# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).post_init(_post_init).build()

    app.add_handler(CommandHandler("chatid",     cmd_chatid))
    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("play",       cmd_play))
    app.add_handler(CommandHandler("membership", cmd_membership))
    app.add_handler(CommandHandler("cancel",     cmd_cancel))

    app.add_handler(CallbackQueryHandler(cb_membership_info, pattern="^membership_info$"))
    app.add_handler(CallbackQueryHandler(cb_buy_premium,     pattern="^buy_premium$"))
    app.add_handler(CallbackQueryHandler(cb_referral_link,   pattern="^referral_link$"))
    app.add_handler(CallbackQueryHandler(cb_register_check,  pattern="^register_check$"))
    app.add_handler(CallbackQueryHandler(cb_select_mentor,   pattern="^select_mentor_"))

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_txhash))
    app.add_error_handler(error_handler)

    print("✅ Bot is running (bilingual KO/EN)...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
