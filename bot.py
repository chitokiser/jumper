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
    MessageHandler, ContextTypes, filters, ChatMemberHandler,
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
GROUP_CHAT_ID         = int(os.environ.get("GROUP_CHAT_ID", "0"))
GROUP_INVITE_GP       = 100

_user_state: dict = {}   # {telegram_user_id: 'awaiting_txhash'}
_bot_username: str = ""  # _post_init에서 캐싱
_ton_cache: dict  = {"usd": 0.0, "ts": 0.0}
_TON_CACHE_TTL    = 300  # 5분

# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _fetch_ton_usd() -> float:
    now = datetime.now().timestamp()
    if now - _ton_cache["ts"] < _TON_CACHE_TTL and _ton_cache["usd"] > 0:
        return _ton_cache["usd"]
    resp = _req.get(
        "https://api.coingecko.com/api/v3/simple/price",
        params={"ids": "the-open-network", "vs_currencies": "usd"},
        timeout=8,
    )
    price = float(resp.json()["the-open-network"]["usd"])
    _ton_cache["usd"] = price
    _ton_cache["ts"]  = now
    return price


def _today_utc7() -> str:
    return datetime.now(UTC7).strftime("%Y-%m-%d")

def _uid(tg_id: int) -> str:
    return f"tg_{tg_id}"

async def _run(fn, *args, timeout=20):
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: fn(*args)),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        raise Exception(f"서버 응답 없음 ({timeout}s) — 잠시 후 다시 시도해주세요")

async def _safe_reply(message, text, retry_btn=None):
    """Markdown 없이 안전하게 메시지 전송. 실패해도 plain text로 재시도."""
    from telegram import InlineKeyboardMarkup, InlineKeyboardButton
    markup = InlineKeyboardMarkup([[InlineKeyboardButton("🔄 다시 시도", callback_data=retry_btn)]]) if retry_btn else None
    for pm in ("Markdown", None):
        try:
            await message.reply_text(text if pm else text.replace("*", "").replace("_", "").replace("`", ""),
                                     parse_mode=pm, reply_markup=markup)
            return
        except Exception:
            pass

# ── Firestore ────────────────────────────────────────────────────────────────

def _get_status(uid: str) -> dict:
    user_snap   = _db.collection("users").document(uid).get(timeout=_FS_TIMEOUT)
    player_snap = _db.collection("battle_players").document(uid).get(timeout=_FS_TIMEOUT)
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

    cfg_snap  = _db.collection("membership_config").document("pricing").get(timeout=_FS_TIMEOUT)
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
        snap = _db.collection("users").document(uid).get(timeout=_FS_TIMEOUT)
        if snap.exists:
            wallet = (snap.to_dict() or {}).get("wallet", {})
            if wallet.get("encryptedKey"):
                return wallet
    except Exception:
        pass
    return None


_FS_TIMEOUT = 10  # Firestore gRPC 호출 타임아웃 (초)


def _register_tg_and_give_gp(uid: str, tg_user) -> dict:
    """텔레그램 유저 정보 DB 저장 + 1000 GP 즉시 지급 (멱등)."""
    user_ref = _db.collection("users").document(uid)
    bp_ref   = _db.collection("battle_players").document(uid)

    user_snap = user_ref.get(timeout=_FS_TIMEOUT)
    user_data = user_snap.to_dict() or {}

    # 이미 수탁지갑 보유 → 완전 가입된 상태
    if user_data.get("wallet", {}).get("encryptedKey"):
        return {"status": "already_registered"}

    # 텔레그램 유저 정보 저장
    display_name = " ".join(filter(None, [tg_user.first_name, tg_user.last_name])) \
                   or f"TGUser{tg_user.id}"
    update_doc = {
        "telegramId":  str(tg_user.id),
        "displayName": display_name,
        "username":    tg_user.username or None,
        "source":      "telegram",
        "role":        "user",
        "updatedAt":   firestore.SERVER_TIMESTAMP,
    }
    if not user_snap.exists:
        update_doc["createdAt"] = firestore.SERVER_TIMESTAMP
    user_ref.set(update_doc, merge=True)

    # 이미 보너스 받았으면 스킵
    bp_snap  = bp_ref.get()
    bp_data  = bp_snap.to_dict() or {}
    got_bonus = bool(bp_data.get("joinBonusAt"))
    if got_bonus:
        return {"status": "registered", "got_bonus": False}

    # 정회원 여부 확인 → 레벨4 동시 설정
    today      = _today_utc7()
    coop_until = user_data.get("coopMemberUntil", "")
    is_premium = bool(coop_until and coop_until >= today)

    bp_update = {
        "uid":        uid,
        "displayName": display_name,
        "gold":        firestore.Increment(1000),
        "joinBonusAt": firestore.SERVER_TIMESTAMP,
    }
    if is_premium:
        bp_update["level"]              = 4
        bp_update["pendingOnChainSync"]  = True
        bp_update["pendingOnChainLevel"] = 4

    bp_ref.set(bp_update, merge=True)
    return {"status": "registered", "got_bonus": True, "is_premium": is_premium}


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
    """추천인에게 500 GP 지급 — 지갑 생성 완료 시 호출 (정회원 조건 없음)."""
    pending = _db.collection("pending_referrals").document(new_uid).get()
    if not pending.exists:
        return
    data         = pending.to_dict() or {}
    referrer_uid = data.get("referrerUid")
    if not referrer_uid or referrer_uid == new_uid:
        return

    # 이미 처리된 추천이면 스킵
    dup = _db.collection("membership_referrals").where("newUserUid", "==", new_uid).limit(1).get()
    if len(dup) > 0:
        return

    ref_snap = _db.collection("users").document(referrer_uid).get()
    if not ref_snap.exists:
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


def _get_my_invites(uid: str) -> list:
    snaps = _db.collection("group_invite_rewards").where("inviterUid", "==", uid).get()
    result = []
    for s in snaps:
        d = s.to_dict() or {}
        new_uid = d.get("newMemberUid", "")
        # 멤버 이름 조회
        try:
            u = _db.collection("users").document(new_uid).get(timeout=_FS_TIMEOUT)
            name = (u.to_dict() or {}).get("displayName") or new_uid
        except Exception:
            name = new_uid
        result.append({"name": name, "gp": d.get("gpRewarded", 0)})
    return result


def _get_my_invite_link(uid: str) -> str | None:
    snaps = _db.collection("group_invite_links").where("inviterUid", "==", uid).limit(1).get()
    for s in snaps:
        return (s.to_dict() or {}).get("linkUrl")
    return None


def _store_invite_link(link_url: str, uid: str):
    token = link_url.rstrip("/").split("/")[-1].lstrip("+")
    _db.collection("group_invite_links").document(token).set({
        "inviterUid": uid,
        "linkUrl":    link_url,
        "createdAt":  firestore.SERVER_TIMESTAMP,
    }, merge=True)


def _get_inviter_by_link(link_url: str) -> str | None:
    token = link_url.rstrip("/").split("/")[-1].lstrip("+")
    snap = _db.collection("group_invite_links").document(token).get(timeout=_FS_TIMEOUT)
    return (snap.to_dict() or {}).get("inviterUid") if snap.exists else None


def _reward_group_invite(inviter_uid: str, new_uid: str) -> bool:
    if inviter_uid == new_uid:
        return False
    if _db.collection("group_invite_rewards").document(new_uid).get(timeout=_FS_TIMEOUT).exists:
        return False
    if not _db.collection("users").document(inviter_uid).get(timeout=_FS_TIMEOUT).exists:
        return False
    _db.collection("battle_players").document(inviter_uid).set(
        {"gold": firestore.Increment(GROUP_INVITE_GP)}, merge=True
    )
    _db.collection("group_invite_rewards").document(new_uid).set({
        "inviterUid":   inviter_uid,
        "newMemberUid": new_uid,
        "gpRewarded":   GROUP_INVITE_GP,
        "createdAt":    firestore.SERVER_TIMESTAMP,
    })
    return True

# ── 명령어 핸들러 ─────────────────────────────────────────────────────────────

async def _send_group_invite_link(message, uid: str, context: ContextTypes.DEFAULT_TYPE):
    if not GROUP_CHAT_ID:
        await _safe_reply(message, "❌ 그룹이 설정되지 않았습니다. / Group not configured.")
        return
    try:
        link = await _run(_get_my_invite_link, uid)
        if not link:
            invite = await context.bot.create_chat_invite_link(
                chat_id=GROUP_CHAT_ID,
                name=f"inv_{uid}",
                creates_join_request=False,
            )
            link = invite.invite_link
            await _run(_store_invite_link, link, uid)
        await _safe_reply(message,
            f"🔗 *Your group invite link*\n\n{link}\n\n"
            f"Earn *+{GROUP_INVITE_GP} GP* for every new member who joins!\n"
            f"_(First join only, no duplicates)_"
        )
    except Exception as e:
        print(f"[ERROR] _send_group_invite_link: {e}")
        await _safe_reply(message, "❌ Failed to create link. Make sure the bot is a group admin with invite link permission.")


async def cmd_mylink(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = _uid(update.effective_user.id)
    await _send_group_invite_link(update.message, uid, context)


async def cmd_myinvites(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = _uid(update.effective_user.id)
    try:
        invites = await _run(_get_my_invites, uid)
        if not invites:
            await _safe_reply(update.message,
                "👥 *No invited members yet.*\n\n"
                "Use /mylink to get your group invite link!"
            )
            return
        total_gp = sum(i["gp"] for i in invites)
        lines = "\n".join(f"• {i['name']} (+{i['gp']} GP)" for i in invites)
        await _safe_reply(update.message,
            f"👥 *My Invited Members*\n\n"
            f"{lines}\n\n"
            f"Total: *{len(invites)} members* · *+{total_gp} GP* earned"
        )
    except Exception as e:
        print(f"[ERROR] cmd_myinvites: {e}")
        await _safe_reply(update.message, "❌ Failed to load. Please try again later.")


async def _reply_rate(message):
    try:
        usd = await _run(_fetch_ton_usd)
        gp  = int(usd * 10_000)
        await _safe_reply(message,
            f"💱 *TON Exchange Rate*\n\n"
            f"1 TON = *${usd:,.2f}* USD\n"
            f"1 TON = *{gp:,} GP*\n\n"
            f"_(Updates every 5 min · Source: CoinGecko)_"
        )
    except Exception as e:
        print(f"[ERROR] _reply_rate: {e}")
        await _safe_reply(message, "❌ Failed to fetch rate. Please try again.")


async def cmd_rate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _reply_rate(update.message)


async def cb_show_rate(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await _reply_rate(q.message)


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
            bot_name = _bot_username or context.bot.username or (await context.bot.get_me()).username
            keyboard = [[
                InlineKeyboardButton("🎮 Open JumpDAO Bot", url=f"https://t.me/{bot_name}?start=hi"),
            ]]
            await update.message.reply_text(
                "*JumpDAO*\n\n"
                "A verified game hub where\n"
                "Game Points ⇔ Toncoin & USDT can be exchanged.\n\n"
                "👇 Tap below to start in a private chat!",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        keyboard = [
            [InlineKeyboardButton("🎮 Game Hub", web_app=WebAppInfo(url=HUB_URL))],
            [InlineKeyboardButton("📝 Register — Get 1,000 GP Airdrop!", callback_data="register_check")],
            [InlineKeyboardButton("👥 Get Referral Link (+500 GP)", callback_data="referral_link")],
            [InlineKeyboardButton("💱 TON → GP Rate", callback_data="show_rate")],
            [InlineKeyboardButton("💬 Join Official Community", url="https://t.me/jumpdao_eng")],
            [InlineKeyboardButton(f"🔗 Invite Friends to Group → +{GROUP_INVITE_GP} GP/person", callback_data="group_invite_link")],
            [
                InlineKeyboardButton("🗺️ Treasure Hunt",  url="https://jump22.netlify.app/treasure.html"),
                InlineKeyboardButton("🏎️ Monster Racing",  url="https://jump22.netlify.app/monsterrace.html"),
            ],
            [
                InlineKeyboardButton("🏹 Archery Hunt",   url="https://jump22.netlify.app/bow.html"),
                InlineKeyboardButton("🃏 Speed Memory",   url="https://jump22.netlify.app/memory.html"),
            ],
            [InlineKeyboardButton("🏃 Relay Race", url="https://jump22.netlify.app/relay.html")],
            [InlineKeyboardButton("🏰 Monster Defense", url="https://jump22.netlify.app/conquest.html")],
            [InlineKeyboardButton("⭐ Premium Benefits", callback_data="membership_info")],
        ]
        await update.message.reply_text(
            "*JumpDAO*\n\n"
            "A verified game hub where\n"
            "Game Points ⇔ Toncoin & USDT can be exchanged.",
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
        await update.message.reply_text("❌ An error occurred. Please try again later.")


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if _user_state.pop(user_id, None):
        await update.message.reply_text("Payment cancelled.")


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
        await _safe_reply(q.message, "❌ An error occurred. Please try again later.", "membership_info")


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
                "⚠️ *Registration required*\n\n"
                "Please complete registration (create wallet) before upgrading to Premium.",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("📝 Register", callback_data="register_check"),
                ]]),
            )
            return

        st      = await _run(_get_status, uid)
        price   = st["ton_price"]

        _user_state[user_id] = "awaiting_txhash"

        addr_display = f"`{TON_DEPOSIT_ADDRESS}`" if TON_DEPOSIT_ADDRESS else "_(address not set — contact admin)_"

        text = (
            f"💎 *Premium TON Payment*\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"💰 Amount: `{price} TON`\n"
            f"📬 Deposit address:\n{addr_display}\n"
            f"━━━━━━━━━━━━━━━━━━\n\n"
            f"1️⃣ Send exactly *{price} TON* to the address above\n\n"
            f"2️⃣ Paste the *transaction hash* into this chat\n\n"
            f"_Hash: TON wallet app → Transaction history → Details_\n\n"
            f"/cancel to abort"
        )
        await q.message.reply_text(text, parse_mode="Markdown")
    except Exception as e:
        print(f"[ERROR] cb_buy_premium: {e}")
        await _safe_reply(q.message, "❌ An error occurred. Please try again later.", "buy_premium")


async def cb_group_invite_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = _uid(q.from_user.id)
    await _send_group_invite_link(q.message, uid, context)


async def cb_referral_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q   = update.callback_query
    await q.answer()
    try:
        uid      = _uid(q.from_user.id)
        bot_name = _bot_username or context.bot.username or (await context.bot.get_me()).username
        if not bot_name:
            raise Exception("bot_name unavailable")
        link     = f"https://t.me/{bot_name}?start=REF{uid}"
        await q.message.reply_text(
            f"👥 *Your Referral Link*\n\n{link}\n\n"
            f"Earn *+500 GP* when your friend creates a custodial wallet!\n"
            f"_(Paid automatically after wallet creation, no Premium required)_",
            parse_mode="Markdown",
        )
    except Exception as e:
        print(f"[ERROR] cb_referral_link: {e}")
        await _safe_reply(q.message, "❌ Failed to generate link. Please try again.", "referral_link")


async def cb_register_check(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """회원가입 버튼 → DB 저장 + 1000 GP 즉시 지급 → 수탁지갑 생성 유도."""
    q = update.callback_query
    await q.answer()
    uid     = _uid(q.from_user.id)
    tg_user = q.from_user

    try:
        result = await _run(_register_tg_and_give_gp, uid, tg_user)

        if result["status"] == "already_registered":
            wallet = await _run(_get_user_wallet, uid)
            addr   = (wallet or {}).get("address", "")
            short  = addr[:8] + "..." + addr[-6:] if addr else "?"
            await q.message.reply_text(
                f"✅ *Already registered*\nWallet: `{short}`",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("⭐ Premium Benefits", callback_data="membership_info"),
                ]]),
            )
            return

        bonus_line = "🎁 *1,000 GP* credited!\n" if result.get("got_bonus") else ""
        level_line = "⭐ Level 4 boost applied!\n" if result.get("is_premium") else ""
        await q.message.reply_text(
            f"✅ *Registration complete!*\n\n"
            f"{bonus_line}"
            f"{level_line}\n"
            f"💼 Create a custodial wallet to unlock on-chain level-up!",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💼 Create Wallet", callback_data="create_wallet")],
                [InlineKeyboardButton("⭐ Premium Benefits", callback_data="membership_info")],
            ]),
        )
    except Exception as e:
        print(f"[ERROR] cb_register_check: {e}")
        await _safe_reply(q.message, "❌ An error occurred. Please try again later.", "register_check")


async def cb_create_wallet(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """수탁지갑 생성 → 멘토 선택 UI."""
    q = update.callback_query
    await q.answer()

    try:
        referrers = await _run(_get_auto_referrers)
        keyboard  = []
        for r in referrers:
            keyboard.append([InlineKeyboardButton(
                f"👤 {r['label']}", callback_data=f"select_mentor_{r['address']}"
            )])
        keyboard.append([InlineKeyboardButton(
            "🏠 Default Mentor",
            callback_data=f"select_mentor_{DEFAULT_MENTOR_ADDR}",
        )])
        await q.message.reply_text(
            "💼 *Create Custodial Wallet — Select Your Mentor*\n\n"
            "Your mentor is registered as your referrer and cannot be changed easily.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    except Exception as e:
        print(f"[ERROR] cb_create_wallet: {e}")
        await _safe_reply(q.message, "❌ An error occurred. Please try again later.", "create_wallet")


async def cb_select_mentor(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """멘토 선택 → Cloud Function telegramRegister 호출 → 지갑 생성 + 온체인 등록."""
    q = update.callback_query
    await q.answer()
    uid            = _uid(q.from_user.id)
    mentor_address = q.data[len("select_mentor_"):]

    # 처리 중 메시지 — edit_text로 결과를 덮어쓰므로 delete 불필요
    wait_msg = await q.message.reply_text(
        "⏳ *[1/3] Creating wallet...*\n_Please wait (up to 90 sec)_",
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
                f"✅ *Already registered*\nWallet: `{short}`",
                [[InlineKeyboardButton("⭐ Go Premium", callback_data="membership_info")]],
            )
            return

        try:
            await _run(_process_pending_referral, uid)
        except Exception:
            pass

        chain_line = "On-chain registration complete\n" if registered else "On-chain registration in progress (auto)\n"
        bonus_line = "🎁 *1,000 GP* credited!\n" if join_bonus else ""
        await _edit(
            f"🎉 *Wallet Created!*\n\n"
            f"💼 Wallet: `{address}`\n"
            f"{chain_line}"
            f"{bonus_line}\n"
            f"You can now upgrade to Premium!",
            [[InlineKeyboardButton("⭐ Join Premium", callback_data="membership_info")]],
        )

    except Exception as e:
        print(f"[ERROR] cb_select_mentor: {e}")
        err_msg = str(e)
        if "timeout" in err_msg.lower() or "timed out" in err_msg.lower():
            err_msg = "Server timeout — please try again later"
        await _edit(
            f"❌ *Registration failed*\n\n"
            f"{err_msg}\n\n"
            "Please retry later or contact support.",
            [[InlineKeyboardButton("🔄 Retry", callback_data="register_check")]],
        )

# ── 그룹 멤버 입장 감지 ──────────────────────────────────────────────────────

async def on_chat_member(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cm = update.chat_member
    if not GROUP_CHAT_ID or cm.chat.id != GROUP_CHAT_ID:
        return

    old_st = cm.old_chat_member.status
    new_st = cm.new_chat_member.status
    # 신규 입장만 처리 (left/kicked/none → member)
    if new_st not in ("member", "restricted") or old_st in ("member", "administrator", "creator", "restricted"):
        return

    new_member  = cm.new_chat_member.user
    new_uid     = _uid(new_member.id)
    inviter_uid = None

    # 환영 메시지
    try:
        name     = new_member.first_name or "there"
        bot_name = _bot_username or context.bot.username or ""
        welcome  = (
            f"👋 Welcome, <b>{name}</b>!\n\n"
            f"🎁 <b>Register</b> → Get <b>1,000 GP</b> instantly\n"
            f"🔗 <b>Invite friends</b> → Earn <b>+{GROUP_INVITE_GP} GP</b> per person\n\n"
            f"Tap below to start! 👇"
        )
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("🎮 Start JumpDAO", url=f"https://t.me/{bot_name}?start=hi")
        ]]) if bot_name else None
        await context.bot.send_message(chat_id=GROUP_CHAT_ID, text=welcome,
                                       parse_mode="HTML", reply_markup=kb,
                                       disable_notification=True)
    except Exception:
        pass

    # 방법1: 추적 초대링크로 입장
    if cm.invite_link:
        try:
            inviter_uid = await _run(_get_inviter_by_link, cm.invite_link.invite_link)
        except Exception:
            pass

    # 방법2: 직접 추가 (Add Member)
    if not inviter_uid and cm.from_user and not cm.from_user.is_bot:
        if cm.from_user.id != cm.new_chat_member.user.id:
            inviter_uid = _uid(cm.from_user.id)

    if not inviter_uid:
        return

    try:
        rewarded = await _run(_reward_group_invite, inviter_uid, new_uid)
        if rewarded:
            try:
                tg_id = int(inviter_uid.replace("tg_", ""))
                await context.bot.send_message(
                    chat_id=tg_id,
                    text=f"🎉 *Invite Reward!*\n\n*+{GROUP_INVITE_GP} GP* has been credited to your account!",
                    parse_mode="Markdown",
                )
            except Exception:
                pass
    except Exception as e:
        print(f"[ERROR] on_chat_member: {e}")

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
        "🔍 *Verifying payment...*\n_Please wait (up to 20 sec)_",
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
        bot_name  = _bot_username or context.bot.username or (await context.bot.get_me()).username
        invite    = f"https://t.me/{bot_name}?start=REF{uid}"

        text = (
            f"🎉 *Premium Activated!*\n\n"
            f"✅ Payment verified\n"
            f"Expires: `{expiry}`\n"
            f"🎁 Daily 3,500 GP top-up activated (when GP ≤ 1,000)\n"
        )
        if is_first:
            text += "🎮 Level 4 boost applied!\n"
        text += f"\n👥 Your referral link:\n`{invite}`"

        await _edit_pay(text)

    except Exception as e:
        _user_state[user_id] = "awaiting_txhash"
        print(f"[ERROR] handle_txhash: {e}")
        await _edit_pay(
            f"❌ *Verification failed*\n\n"
            f"{e}\n\n"
            "Please check the hash and try again, or\n"
            "/cancel to abort"
        )

# ── 공통 UI ───────────────────────────────────────────────────────────────────

async def _send_membership_ui(message, st: dict):
    price = st["ton_price"]
    if st["is_premium"]:
        gp = st.get("current_gp", 0)
        if st.get("topup_claimed"):
            topup_line = "✅ Today's 3,500 GP top-up claimed"
        elif gp > TOPUP_THRESHOLD:
            topup_line = f"🟡 GP {gp:,} — GP above 1,000, top-up unavailable"
        else:
            topup_line = "🎁 3,500 GP available! Claim in Game Hub"

        text = (
            f"⭐ *Premium Member*\n"
            f"Expires: `{st['expires_at']}` (D-{st['days_left']})\n\n"
            f"💰 Current GP: `{gp:,}`\n"
            f"{topup_line}"
        )
        keyboard = [
            [InlineKeyboardButton("🔄 Extend 30 days", callback_data="buy_premium")],
            [InlineKeyboardButton("👥 Referral link", callback_data="referral_link")],
        ]
    else:
        text = (
            "Free Member\n\n"
            "⭐ *Premium Benefits:*\n"
            "• 🎁 Daily 3,500 GP top-up _(when GP ≤ 1,000)_\n"
            "• Exclusive Premium treasure boxes\n"
            "• Instant Level 4 boost _(first time only)_\n"
            "• 500 GP reward per referral\n\n"
            f"Price: 💎 {price} TON / 30 days"
        )
        keyboard = [
            [InlineKeyboardButton(
                f"💎 Join Premium ({price} TON)",
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
    global _bot_username
    try:
        me = await application.bot.get_me()
        _bot_username = me.username or ""
        print(f"[OK] Bot: @{_bot_username}")
    except Exception as e:
        print(f"[WARN] get_me failed: {e}")
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
    app.add_handler(CommandHandler("mylink",     cmd_mylink))
    app.add_handler(CommandHandler("myinvites",  cmd_myinvites))
    app.add_handler(CommandHandler("rate",       cmd_rate))

    app.add_handler(CallbackQueryHandler(cb_membership_info,   pattern="^membership_info$"))
    app.add_handler(CallbackQueryHandler(cb_buy_premium,       pattern="^buy_premium$"))
    app.add_handler(CallbackQueryHandler(cb_referral_link,     pattern="^referral_link$"))
    app.add_handler(CallbackQueryHandler(cb_show_rate,         pattern="^show_rate$"))
    app.add_handler(CallbackQueryHandler(cb_group_invite_link, pattern="^group_invite_link$"))
    app.add_handler(CallbackQueryHandler(cb_register_check,    pattern="^register_check$"))
    app.add_handler(CallbackQueryHandler(cb_create_wallet,     pattern="^create_wallet$"))
    app.add_handler(CallbackQueryHandler(cb_select_mentor,     pattern="^select_mentor_"))

    app.add_handler(ChatMemberHandler(on_chat_member, ChatMemberHandler.CHAT_MEMBER))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_txhash))
    app.add_error_handler(error_handler)

    print("✅ Bot is running (bilingual KO/EN)...")
    app.run_polling(drop_pending_updates=True, allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
