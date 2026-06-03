import os
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup, LabeledPrice,
)
from telegram.ext import (
    ApplicationBuilder, CommandHandler, CallbackQueryHandler,
    PreCheckoutQueryHandler, MessageHandler, ContextTypes, filters,
)

import firebase_admin
from firebase_admin import credentials, firestore

# ── Firebase 초기화 ───────────────────────────────────────────────────────────
_sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "{}")
_cred    = credentials.Certificate(json.loads(_sa_json))
firebase_admin.initialize_app(_cred)
_db      = firestore.client()

BOT_TOKEN      = os.environ["BOT_TOKEN"]
STARS_PRICE    = int(os.environ.get("MEMBERSHIP_STARS_PRICE", "500"))
FREE_ENTRY_MAX = 3
UTC7           = timezone(timedelta(hours=7))
_executor      = ThreadPoolExecutor(max_workers=4)

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

    free_key    = f"freeEntry_{today}"
    free_used   = player.get(free_key, 0)

    cfg_snap    = _db.collection("membership_config").document("pricing").get()
    stars_price = (cfg_snap.to_dict() or {}).get("starsPrice", STARS_PRICE) if cfg_snap.exists else STARS_PRICE

    return {
        "is_premium":  is_prem,
        "expires_at":  expiry or None,
        "days_left":   days_left,
        "free_used":   free_used,
        "free_left":   max(0, FREE_ENTRY_MAX - free_used) if is_prem else 0,
        "name":        user.get("displayName") or user.get("name") or "회원",
        "stars_price": stars_price,
    }


def _activate(uid: str, payment_id: str, stars_amount: int) -> str:
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

    # 최초 가입: 레벨 4 지급 (현재 레벨 < 4 인 경우만)
    if is_first:
        p_ref  = _db.collection("battle_players").document(uid)
        p_snap = p_ref.get()
        level  = (p_snap.to_dict() or {}).get("level", 1) if p_snap.exists else 1
        if level < 4:
            p_ref.set({"level": 4}, merge=True)

    _db.collection("membership_payments").document(payment_id).set({
        "uid":               uid,
        "starsAmount":       stars_amount,
        "paymentId":         payment_id,
        "expiresAt":         new_expiry,
        "createdMonth":      new_expiry[:7],
        "isFirstMembership": is_first,
        "createdAt":         firestore.SERVER_TIMESTAMP,
    })
    return new_expiry


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

# ── 핸들러 ────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = context.args or []
    uid  = _uid(update.effective_user.id)

    if args and args[0].startswith("REF"):
        await _run(_save_pending_referral, uid, args[0][3:])

    keyboard = [
        [InlineKeyboardButton("🎮 JUMP22 Game Hub",
            url="https://jump22.netlify.app/merchants")],
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


async def cb_membership_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = _uid(q.from_user.id)
    st  = await _run(_get_status, uid)
    await _send_membership_ui(q.message, st)


async def cb_buy_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q     = update.callback_query
    await q.answer()
    uid   = _uid(q.from_user.id)
    st    = await _run(_get_status, uid)
    price = st["stars_price"]

    await context.bot.send_invoice(
        chat_id=q.message.chat_id,
        title="⭐ JumpDAO Premium Membership",
        description=(
            "30일 정회원 혜택:\n"
            "• 매일 무료 게임 입장 3회\n"
            "• 정회원 전용 보물박스\n"
            "• 레벨 4 즉시 부스트 (최초 1회)\n"
            "• 친구 초대 500 GP 보상"
        ),
        payload=f"premium_{uid}",
        currency="XTR",
        prices=[LabeledPrice("Premium Membership (30일)", price)],
    )


async def pre_checkout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.pre_checkout_query.answer(ok=True)


async def successful_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pay        = update.message.successful_payment
    uid        = pay.invoice_payload.replace("premium_", "")
    pay_id     = pay.telegram_payment_charge_id
    stars      = pay.total_amount

    new_expiry = await _run(_activate, uid, pay_id, stars)
    await _run(_process_pending_referral, uid)

    bot_name = (await context.bot.get_me()).username
    invite   = f"https://t.me/{bot_name}?start=REF{uid}"
    await update.message.reply_text(
        f"🎉 *정회원 가입 완료!*\n\n"
        f"만료일: `{new_expiry}`\n"
        f"매일 무료 게임 입장 3회가 활성화됩니다.\n\n"
        f"👥 친구 초대 링크:\n`{invite}`",
        parse_mode="Markdown",
    )


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


async def cmd_play(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, context)

# ── 공통 UI ───────────────────────────────────────────────────────────────────

async def _send_membership_ui(message, st: dict):
    if st["is_premium"]:
        text = (
            f"⭐ *Premium Member*\n"
            f"만료일: `{st['expires_at']}` (D-{st['days_left']})\n"
            f"오늘 무료 입장: {st['free_used']} / {FREE_ENTRY_MAX}회 사용"
        )
        keyboard = [
            [InlineKeyboardButton("🔄 30일 연장",        callback_data="buy_premium")],
            [InlineKeyboardButton("👥 친구 초대 링크",   callback_data="referral_link")],
        ]
    else:
        text = (
            "일반회원\n\n"
            "⭐ 정회원 혜택:\n"
            "• 매일 무료 게임 입장 3회\n"
            "• 정회원 전용 보물박스\n"
            "• 레벨 4 즉시 부스트 (최초 1회)\n"
            "• 친구 초대 500 GP 보상\n\n"
            f"가격: ⭐ {st['stars_price']} Stars / 30일"
        )
        keyboard = [
            [InlineKeyboardButton(
                f"⭐ 정회원 가입 ({st['stars_price']} Stars)",
                callback_data="buy_premium",
            )],
        ]
    await message.reply_text(
        text, parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

# ── 진입점 ────────────────────────────────────────────────────────────────────

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("play",       cmd_play))
    app.add_handler(CommandHandler("membership", cmd_membership))

    app.add_handler(CallbackQueryHandler(cb_membership_info, pattern="^membership_info$"))
    app.add_handler(CallbackQueryHandler(cb_buy_premium,     pattern="^buy_premium$"))
    app.add_handler(CallbackQueryHandler(cb_referral_link,   pattern="^referral_link$"))

    app.add_handler(PreCheckoutQueryHandler(pre_checkout))
    app.add_handler(MessageHandler(filters.SUCCESSFUL_PAYMENT, successful_payment))

    print("✅ Bot is running...")
    app.run_polling()

if __name__ == "__main__":
    main()
