// functions/wallet/exchange.js
// KRW / USD / VND 환율 조회 + HEX wei 변환
// Primary: open.er-api.com (무료, 키 불필요)
// Fallback: exchangerate.host

'use strict';

const https = require('https');

// ────────────────────────────────────────────────
// 환율 조회
// ────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse 실패: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('환율 API 타임아웃')));
  });
}

/**
 * USD 기준 KRW, VND 환율 반환
 * @returns {{ krwPerUsd: number, vndPerUsd: number, source: string }}
 */
async function fetchExchangeRates() {
  // Primary: open.er-api.com (free tier, no key)
  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
    if (data.result === 'success' && data.rates?.KRW && data.rates?.VND) {
      return {
        krwPerUsd: data.rates.KRW,
        vndPerUsd: data.rates.VND,
        source: 'open.er-api.com',
        updatedAt: data.time_last_update_utc,
      };
    }
  } catch (_) { /* fallback으로 */ }

  // Fallback: exchangerate.host
  try {
    const data = await fetchJson('https://api.exchangerate.host/latest?base=USD&symbols=KRW,VND');
    if (data.success && data.rates?.KRW && data.rates?.VND) {
      return {
        krwPerUsd: data.rates.KRW,
        vndPerUsd: data.rates.VND,
        source: 'exchangerate.host',
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (_) { /* 하드코딩 폴백 */ }

  // 최후 폴백 (운영 중 API 장애 시 – 하루 1회 이상 반드시 갱신 필요)
  console.warn('[exchange] 모든 환율 API 실패. 하드코딩 폴백 사용 중');
  return {
    krwPerUsd: 1370,
    vndPerUsd: 25400,
    source: 'hardcoded-fallback',
    updatedAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────
// 단위 변환
// ────────────────────────────────────────────────

/**
 * KRW → HEX wei  (1 HEX = 1 USD 가정, 18 decimals)
 * hexWei = floor(krwAmount / krwPerUsd) * 1e18
 *
 * BigInt 사용: 정수 계산으로 정밀도 손실 방지
 * @param {number} krwAmount   - 원화 금액 (정수)
 * @param {number} krwPerUsd   - 달러당 원화 환율 (예: 1370.5)
 * @returns {bigint}
 */
function krwToHexWei(krwAmount, krwPerUsd) {
  // 소수점 4자리까지 보존: * 10000
  const krwScaled    = BigInt(Math.round(krwAmount * 10000));
  const rateScaled   = BigInt(Math.round(krwPerUsd * 10000));
  // usdWei = (krw * 1e18) / rate  – 단, 정수 나눗셈
  // = (krwScaled * 1e18) / rateScaled  (단위: 1e-4 USD → wei)
  // 분자:  krwAmount * 1e18
  // 분모:  krwPerUsd
  // = (krwScaled * 10n**18n) / rateScaled
  return (krwScaled * (10n ** 18n)) / rateScaled;
}

/**
 * KRW → USD (표시용)
 * @param {number} krwAmount
 * @param {number} krwPerUsd
 * @returns {number} USD (소수 4자리)
 */
function krwToUsd(krwAmount, krwPerUsd) {
  return Math.round((krwAmount / krwPerUsd) * 10000) / 10000;
}

/**
 * KRW → VND (표시용)
 * @param {number} krwAmount
 * @param {number} krwPerUsd
 * @param {number} vndPerUsd
 * @returns {number} VND (정수)
 */
function krwToVnd(krwAmount, krwPerUsd, vndPerUsd) {
  return Math.round((krwAmount / krwPerUsd) * vndPerUsd);
}

/**
 * usdKrwSnapshotScaled: 컨트랙트 이벤트 감사용 (x100, 정수)
 * 예: 1370.50 KRW/USD → 137050
 */
function toSnapshotScaled(krwPerUsd) {
  return Math.round(krwPerUsd * 100);
}

module.exports = {
  fetchExchangeRates,
  krwToHexWei,
  krwToUsd,
  krwToVnd,
  toSnapshotScaled,
};
