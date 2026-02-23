// functions/wallet/crypto.js
// AES-256-GCM 암호화/복호화 – 수탁 지갑 private key 보호용
// Firebase Secret Manager에 저장된 WALLET_MASTER_SECRET을 키 소재로 사용

'use strict';

const { createCipheriv, createDecipheriv, randomBytes, createHash } = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 12;   // GCM 권장 96-bit IV
const TAG_LEN   = 16;   // GCM auth tag

/**
 * 마스터 시크릿(임의 길이 문자열) → 32-byte 키 파생
 */
function deriveKey(masterSecret) {
  return createHash('sha256').update(masterSecret, 'utf8').digest();
}

/**
 * encrypt(plaintext, masterSecret) → "iv:tag:ciphertext" (모두 hex)
 * Firestore에는 이 문자열만 저장
 */
function encrypt(plaintext, masterSecret) {
  if (!masterSecret) throw new Error('[crypto] WALLET_MASTER_SECRET이 설정되지 않았습니다');
  const key    = deriveKey(masterSecret);
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * decrypt(encryptedData, masterSecret) → plaintext
 * 인증 실패 시 throws (키가 틀리거나 데이터 변조 시)
 */
function decrypt(encryptedData, masterSecret) {
  if (!masterSecret) throw new Error('[crypto] WALLET_MASTER_SECRET이 설정되지 않았습니다');
  const parts = encryptedData.split(':');
  if (parts.length !== 3) throw new Error('[crypto] 잘못된 암호문 형식');

  const [ivHex, tagHex, ciphertextHex] = parts;
  const key       = deriveKey(masterSecret);
  const iv        = Buffer.from(ivHex,        'hex');
  const tag       = Buffer.from(tagHex,       'hex');
  const ciphertext= Buffer.from(ciphertextHex,'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
