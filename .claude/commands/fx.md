# FX / 금액 표시 헬퍼

## 표시 원칙
금액은 항상 KRW / VND / HEX 세 가지를 모두 표시한다.
패턴: `[krwStr, vndStr, hexStr].filter(Boolean).join(' / ')`

## 프론트엔드 헬퍼 (coop.js 등에 정의)

```js
function hexWeiToKrw(weiStr, rates) {
  const hex = Number(BigInt(weiStr)) / 1e18;
  return rates.krwPerUsd > 0
    ? Math.round(hex * rates.krwPerHex).toLocaleString() + '원'
    : '-';
}

function hexWeiToVnd(weiStr, rates) {
  const hex = Number(BigInt(weiStr)) / 1e18;
  return rates.vndPerUsd > 0
    ? Math.round(hex * rates.vndPerHex).toLocaleString() + '동'
    : '';
}
```

## 서버 헬퍼

```js
const { fetchExchangeRates } = require('../wallet/exchange');
// → { krwPerUsd, vndPerUsd }

// KRW → HEX wei
const { krwToHexWei } = require('../wallet/chain');
// krwToHexWei(krwAmount, usdKrwRate) → BigInt wei

// VND → KRW 변환 예시
const krw = Math.round((amountVnd / rates.vndPerUsd) * rates.krwPerUsd);
// KRW → VND 변환 예시
const vnd = Math.round((amountKrw / rates.krwPerUsd) * rates.vndPerUsd);
```

## 결제 결과 표시 패턴 (pay.js, mypage.js 등)

```js
const krwStr = `${(d.amountKrw || 0).toLocaleString()}원`;
const vndStr = d.amountVnd ? `${Math.round(d.amountVnd).toLocaleString()}동` : '';
const hexStr = `${d.amountHex || '?'} HEX`;
const amountDisp = [krwStr, vndStr, hexStr].filter(Boolean).join(' / ');
```

## 온체인 FX (chain.js)

```js
const fxKrw = await platform.fxKrwPerHexScaled();  // scaled
const fxVnd = await platform.fxVndPerHexScaled();
const scale  = await platform.fxScale();            // 1e8
const krwPerHex = Number(fxKrw) / Number(scale);
const vndPerHex = Number(fxVnd) / Number(scale);
```
