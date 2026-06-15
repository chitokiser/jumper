'use strict';
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { isAdminUid } = require('../wallet/admin');

const db = admin.firestore();

const HARBOR_COST    = 100000;
const SHIP_COST      = 10000;
const MAX_SHIPS      = 10;
const SHIP_LIFE_MS   = 365 * 24 * 60 * 60 * 1000;
const CLAIM_ITVL_MS  = 24 * 60 * 60 * 1000;
const HARBOR_RADIUS  = 5000; // meters

// Jackpot coefficient: daily dividend = floor(jackpot / coefficient)
const GRADE_COEFF = [0, 10000, 50000, 100000, 200000, 400000, 800000, 1600000, 3200000, 6400000, 12800000];

function haversineM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Read jackpot document. Optionally inside a transaction.
async function _readJackpot(tx) {
  const ref  = db.doc('meta/harbor_jackpot');
  const snap = tx ? await tx.get(ref) : await ref.get();
  const d    = snap.exists ? snap.data() : {};
  const port = d.total_port_revenue  ?? 0;
  const ship = d.total_ship_revenue  ?? 0;
  const paid = d.total_dividends_paid ?? 0;
  return { ref, port, ship, paid, current: port + ship - paid };
}

// ── Install harbor ─────────────────────────────────────────────────────────────
async function installHarbor(uid, { lat, lng, shopId, seaZone }) {
  if (!shopId)                           throw new HttpsError('invalid-argument', 'shopId is required');
  if (typeof lat !== 'number' || typeof lng !== 'number')
                                         throw new HttpsError('invalid-argument', 'Valid lat/lng required');
  if (!seaZone)                          throw new HttpsError('failed-precondition', 'Location must be in a sea zone');

  const shopSnap = await db.collection('game_shops').doc(shopId).get();
  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');
  const shop = shopSnap.data();
  if (shop.type !== 'potion' && shop.type !== 'shop_potion') {
    throw new HttpsError('failed-precondition', 'Harbor can only be placed near a potion shop');
  }

  const distToShop = haversineM(lat, lng, shop.lat, shop.lng);
  if (distToShop > HARBOR_RADIUS) {
    throw new HttpsError('failed-precondition',
      `Location must be within 5km of the shop (current: ${Math.round(distToShop)}m away)`);
  }

  return await db.runTransaction(async tx => {
    const playerRef  = db.collection('battle_players').doc(uid);
    const playerSnap = await tx.get(playerRef);
    if (!playerSnap.exists) throw new HttpsError('not-found', 'Player not found');

    const gp = playerSnap.data().gold ?? 0;
    if (gp < HARBOR_COST) {
      throw new HttpsError('failed-precondition',
        `Insufficient GP. Need ${HARBOR_COST.toLocaleString()}, have ${gp.toLocaleString()}`);
    }

    const jk = await _readJackpot(tx);

    const harborRef = db.collection('harbors').doc();
    const now       = admin.firestore.FieldValue.serverTimestamp();

    tx.set(harborRef, {
      owner_id:   uid,
      shop_id:    shopId,
      shop_lat:   shop.lat,
      shop_lng:   shop.lng,
      lat,
      lng,
      ship_count: 0,
      status:     'active',
      created_at: now,
    });

    tx.update(playerRef, {
      gold: admin.firestore.FieldValue.increment(-HARBOR_COST),
    });

    tx.set(jk.ref, {
      total_port_revenue:   admin.firestore.FieldValue.increment(HARBOR_COST),
      total_ship_revenue:   jk.ship,
      total_dividends_paid: jk.paid,
    }, { merge: true });

    return {
      harborId:    harborRef.id,
      cost:        HARBOR_COST,
      newJackpot:  jk.current + HARBOR_COST,
    };
  });
}

// ── Build a trade ship at a harbor ─────────────────────────────────────────────
async function buildTradeShip(uid, { harborId }) {
  if (!harborId) throw new HttpsError('invalid-argument', 'harborId is required');

  return await db.runTransaction(async tx => {
    const harborRef  = db.collection('harbors').doc(harborId);
    const playerRef  = db.collection('battle_players').doc(uid);

    const [harborSnap, playerSnap] = await Promise.all([
      tx.get(harborRef),
      tx.get(playerRef),
    ]);

    if (!harborSnap.exists) throw new HttpsError('not-found', 'Harbor not found');
    if (!playerSnap.exists) throw new HttpsError('not-found', 'Player not found');

    const harbor = harborSnap.data();
    if (harbor.status !== 'active') throw new HttpsError('failed-precondition', 'Harbor is not active');
    if ((harbor.ship_count ?? 0) >= MAX_SHIPS) {
      throw new HttpsError('failed-precondition', `Harbor is at full capacity (${MAX_SHIPS} ships)`);
    }

    const gp = playerSnap.data().gold ?? 0;
    if (gp < SHIP_COST) {
      throw new HttpsError('failed-precondition',
        `Insufficient GP. Need ${SHIP_COST.toLocaleString()}, have ${gp.toLocaleString()}`);
    }

    const grade     = Math.floor(Math.random() * 10) + 1;
    const nowMs     = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowMs + SHIP_LIFE_MS);
    const createdTs = admin.firestore.Timestamp.fromMillis(nowMs);
    const jk        = await _readJackpot(tx);

    const shipRef = db.collection('trade_ships').doc();

    tx.set(shipRef, {
      owner_id:        uid,
      harbor_id:       harborId,
      harbor_lat:      harbor.lat,
      harbor_lng:      harbor.lng,
      grade,
      created_at:      admin.firestore.FieldValue.serverTimestamp(),
      expires_at:      expiresAt,
      last_claimed_at: createdTs,
      status:          'active',
    });

    tx.update(harborRef, {
      ship_count: admin.firestore.FieldValue.increment(1),
    });

    tx.update(playerRef, {
      gold: admin.firestore.FieldValue.increment(-SHIP_COST),
    });

    tx.set(jk.ref, {
      total_port_revenue:   jk.port,
      total_ship_revenue:   admin.firestore.FieldValue.increment(SHIP_COST),
      total_dividends_paid: jk.paid,
    }, { merge: true });

    return {
      shipId:          shipRef.id,
      grade,
      gradeCoeff:      GRADE_COEFF[grade],
      cost:            SHIP_COST,
      expiresAtMs:     expiresAt.toMillis(),
      newJackpot:      jk.current + SHIP_COST,
    };
  });
}

// ── Claim dividends for all eligible owned ships ────────────────────────────────
// Eligibility: ship active, not expired, 24h since last_claimed_at
// Each claim advances last_claimed_at += 24h (not = now) to discard excess time
async function claimShipDividend(uid) {
  const nowMs        = Date.now();
  const nowTs        = admin.firestore.Timestamp.fromMillis(nowMs);

  const shipsSnap = await db.collection('trade_ships')
    .where('owner_id', '==', uid)
    .where('expires_at', '>', nowTs)
    .get();

  if (shipsSnap.empty) {
    return { claimed: 0, shipCount: 0, message: 'No active ships found' };
  }

  const eligible = shipsSnap.docs.filter(doc => {
    const lastMs = doc.data().last_claimed_at?.toMillis() ?? 0;
    return (nowMs - lastMs) >= CLAIM_ITVL_MS;
  });

  if (eligible.length === 0) {
    const nextMs = shipsSnap.docs.reduce((min, doc) => {
      const last = doc.data().last_claimed_at?.toMillis() ?? 0;
      return Math.min(min, last + CLAIM_ITVL_MS);
    }, Infinity);
    return { claimed: 0, shipCount: shipsSnap.size, nextClaimMs: nextMs, message: 'No ships ready yet' };
  }

  return await db.runTransaction(async tx => {
    // Re-read each eligible ship inside transaction to prevent race conditions
    const freshSnaps = await Promise.all(eligible.map(d => tx.get(d.ref)));
    const jk         = await _readJackpot(tx);

    let totalDividend = 0;
    const payable = [];

    for (const snap of freshSnaps) {
      if (!snap.exists) continue;
      const d        = snap.data();
      const lastMs   = d.last_claimed_at?.toMillis() ?? 0;
      if ((nowMs - lastMs) < CLAIM_ITVL_MS) continue; // was already claimed by another session
      const coeff    = GRADE_COEFF[d.grade] ?? GRADE_COEFF[1];
      const daily    = Math.floor(jk.current / coeff);
      totalDividend += daily;
      payable.push({ ref: snap.ref, lastMs, grade: d.grade });
    }

    totalDividend = Math.max(0, Math.min(totalDividend, jk.current));
    if (totalDividend <= 0) {
      return { claimed: 0, shipCount: shipsSnap.size, message: 'Jackpot is empty' };
    }

    for (const { ref, lastMs } of payable) {
      tx.update(ref, {
        last_claimed_at: admin.firestore.Timestamp.fromMillis(lastMs + CLAIM_ITVL_MS),
      });
    }

    const playerRef = db.collection('battle_players').doc(uid);
    tx.update(playerRef, {
      gold: admin.firestore.FieldValue.increment(totalDividend),
    });

    tx.set(jk.ref, {
      total_dividends_paid: admin.firestore.FieldValue.increment(totalDividend),
    }, { merge: true });

    return {
      claimed:     totalDividend,
      shipCount:   payable.length,
      newJackpot:  jk.current - totalDividend,
    };
  });
}

// ── Get nearby harbors ─────────────────────────────────────────────────────────
async function getNearbyHarbors(uid, { lat, lng, radiusKm = 25 }) {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new HttpsError('invalid-argument', 'lat and lng are required');
  }
  const deg  = radiusKm / 111.32;
  const snap = await db.collection('harbors')
    .where('lat', '>=', lat - deg)
    .where('lat', '<=', lat + deg)
    .get();

  const harbors = snap.docs
    .map(d => {
      const h = d.data();
      return {
        id:          d.id,
        owner_id:    h.owner_id,
        shop_id:     h.shop_id,
        lat:         h.lat,
        lng:         h.lng,
        shop_lat:    h.shop_lat ?? null,
        shop_lng:    h.shop_lng ?? null,
        ship_count:  h.ship_count ?? 0,
        status:      h.status,
        created_at:  h.created_at?.toMillis?.() ?? null,
      };
    })
    .filter(h => h.status === 'active' && haversineM(lat, lng, h.lat, h.lng) <= radiusKm * 1000);

  return { harbors };
}

// ── Get my ships ───────────────────────────────────────────────────────────────
async function getMyShips(uid) {
  const nowMs = Date.now();
  const nowTs = admin.firestore.Timestamp.fromMillis(nowMs);

  const [shipsSnap, jk] = await Promise.all([
    db.collection('trade_ships')
      .where('owner_id', '==', uid)
      .where('expires_at', '>', nowTs)
      .get(),
    _readJackpot(null),
  ]);

  const ships = shipsSnap.docs.map(d => {
    const s          = d.data();
    const coeff      = GRADE_COEFF[s.grade] ?? GRADE_COEFF[1];
    const dailyDiv   = Math.floor(jk.current / coeff);
    const lastMs     = s.last_claimed_at?.toMillis() ?? 0;
    const canClaim   = (nowMs - lastMs) >= CLAIM_ITVL_MS;
    const nextClaimMs = lastMs + CLAIM_ITVL_MS;
    const daysLeft   = Math.ceil((s.expires_at.toMillis() - nowMs) / (24 * 3600 * 1000));
    return {
      id:           d.id,
      harbor_id:    s.harbor_id,
      grade:        s.grade,
      gradeCoeff:   coeff,
      dailyDiv,
      canClaim,
      nextClaimMs,
      daysLeft,
      expiresAtMs:  s.expires_at?.toMillis?.() ?? null,
    };
  });

  return {
    ships,
    jackpot:          jk.current,
    totalDailyDiv:    ships.reduce((s, sh) => s + sh.dailyDiv, 0),
    eligibleCount:    ships.filter(sh => sh.canClaim).length,
  };
}

// ── Get harbor jackpot ─────────────────────────────────────────────────────────
async function getHarborJackpot() {
  const jk = await _readJackpot(null);
  return { jackpot: jk.current, port: jk.port, ship: jk.ship, paid: jk.paid };
}

// ── Delete harbor (owner or admin, no active ships) ────────────────────────────
async function deleteHarbor(uid, { harborId }) {
  if (!harborId) throw new HttpsError('invalid-argument', 'harborId is required');

  const harborRef  = db.collection('harbors').doc(harborId);
  const snap       = await harborRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Harbor not found');

  const harbor  = snap.data();
  const isAdmin = await isAdminUid(uid);
  if (harbor.owner_id !== uid && !isAdmin)
    throw new HttpsError('permission-denied', 'You do not own this harbor');
  if (harbor.status   !== 'active') throw new HttpsError('failed-precondition', 'Harbor is not active');

  const nowMs     = Date.now();
  const shipsSnap = await db.collection('trade_ships')
    .where('harbor_id', '==', harborId)
    .get();
  const activeCount = shipsSnap.docs.filter(d => {
    const s = d.data();
    return s.status !== 'expired' && (s.expires_at?.toMillis?.() ?? 0) > nowMs;
  }).length;
  if (activeCount > 0) {
    throw new HttpsError('failed-precondition',
      `Cannot delete harbor with ${activeCount} active ship(s). Wait for all ships to expire first.`);
  }

  await harborRef.update({ status: 'deleted', deleted_at: admin.firestore.FieldValue.serverTimestamp() });
  return { success: true };
}

module.exports = {
  installHarbor,
  buildTradeShip,
  claimShipDividend,
  getNearbyHarbors,
  getMyShips,
  getHarborJackpot,
  deleteHarbor,
};
