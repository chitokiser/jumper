// /functions/index.js
const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");

admin.initializeApp();
const db = admin.firestore();

/*
  items/{itemId}/reviews/{reviewId}
  review 문서 예시:
  {
    rating: 1~5 (number),
    text: "...",
    createdAt: serverTimestamp(),
    uid, displayName ...
  }

  items 문서에 자동 집계:
  - reviewCount
  - reviewSum
  - reviewAvg (소수 1자리)
  - reviewUpdatedAt
*/
exports.aggregateItemReviews = onDocumentWritten(
  "items/{itemId}/reviews/{reviewId}",
  async (event) => {
    const itemId = event.params.itemId;

    // before/after
    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;

    // 아무 것도 없으면 종료
    if (!before && !after) return;

    const bRating = before?.rating != null ? Number(before.rating) : 0;
    const aRating = after?.rating != null ? Number(after.rating) : 0;

    const itemRef = db.collection("items").doc(itemId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(itemRef);
      const cur = snap.exists ? snap.data() : {};

      let count = Number(cur.reviewCount || 0);
      let sum = Number(cur.reviewSum || 0);

      // create
      if (!before && after) {
        count += 1;
        sum += aRating;
      }
      // delete
      else if (before && !after) {
        count = Math.max(0, count - 1);
        sum -= bRating;
      }
      // update
      else if (before && after) {
        sum += aRating - bRating;
      }

      // 안전장치
      if (!Number.isFinite(count) || count < 0) count = 0;
      if (!Number.isFinite(sum) || sum < 0) sum = 0;

      const avg = count ? Math.round((sum / count) * 10) / 10 : 0;

      tx.set(
        itemRef,
        {
          reviewCount: count,
          reviewSum: sum,
          reviewAvg: avg,
          reviewUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    logger.info("aggregateItemReviews updated", { itemId, bRating, aRating });
  }
);
