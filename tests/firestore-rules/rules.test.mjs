import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, addDoc } from 'firebase/firestore';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-rules',
  firestore: { rules: fs.readFileSync(process.argv[2] || new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 }
});
const G = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const U = (uid, email) => env.authenticatedContext(uid, { email, email_verified: false }).firestore();

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'users/member'), { email: 'm@x.com', role: 'VIEWER' });
  await setDoc(doc(db, 'users/ceoA'), { email: 'a@x.com', role: 'CEO', merchantId: 'A', tenantId: 'A' });
  await setDoc(doc(db, 'users/ceoB'), { email: 'b@x.com', role: 'CEO', merchantId: 'B', tenantId: 'B' });
  await setDoc(doc(db, 'users/staffA'), { email: 's@x.com', role: 'STAFF', merchantId: 'A', tenantId: 'A' });
  await setDoc(doc(db, 'users/rich'), { email: 'r@x.com', role: 'VIEWER', points: 10 });
  await setDoc(doc(db, 'employees/empB1'), { contact: 'eb@x.com', tenantId: 'B', name: 'emp' });
  await setDoc(doc(db, 'employees/empA1'), { contact: 'new@x.com', tenantId: 'A', name: 'emp' });
  await setDoc(doc(db, 'nvr_attendance/b1'), { merchantId: 'B' });
  await setDoc(doc(db, 'financeRecords/f1'), { amount: 1 });
  await setDoc(doc(db, 'users/merchN'), { email: 'mn@x.com', role: 'merchant', merchantId: 1791002036 });
  await setDoc(doc(db, 'nvr_attendance/n1'), { merchantId: '1791002036' });
  await setDoc(doc(db, 'users/applicant'), { email: 'ap@x.com', role: 'user' });
  await setDoc(doc(db, 'financeRecords/f2'), { amount: 5 });
  await setDoc(doc(db, 'user_coupons/uc1'), { userId: 'member', status: 'ACTIVE' });
  await setDoc(doc(db, 'menus/m1'), { name: 'galbi', merchantId: 'A' });
  await setDoc(doc(db, 'merchant_products/p1'), { name: 'kimchi', price: 100, group_buy_current: 1 });
  await setDoc(doc(db, 'merchants/B'), { ownerUid: 'ceoB', feeBps: 100, active: true, status: 'approved' });
});

let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, e.message?.slice(0, 120)); } }

const member = G('member', 'm@x.com');
await t('member cannot self-promote to SUPER_ADMIN', assertFails(updateDoc(doc(member, 'users/member'), { role: 'SUPER_ADMIN' })));
await t('member cannot self-promote to CEO', assertFails(updateDoc(doc(member, 'users/member'), { role: 'ceo' })));
await t('member cannot set tenantId', assertFails(updateDoc(doc(member, 'users/member'), { tenantId: 'B' })));
await t('member can still edit own name', assertSucceeds(updateDoc(doc(member, 'users/member'), { name: 'kim', is_merchant_applicant: true })));
await t('applicant flag gives no admin access', assertFails(getDoc(doc(member, 'nvr_attendance/b1'))));
await t('member cannot write admins', assertFails(setDoc(doc(member, 'admins/member'), { x: 1 })));
await t('member cannot read B attendance (catch-all)', assertFails(getDoc(doc(member, 'nvr_attendance/b1'))));

const nodoc = G('nodoc', 'n@x.com');
await t('no-doc user can self-create VIEWER', assertSucceeds(setDoc(doc(nodoc, 'users/nodoc'), { email: 'n@x.com', role: 'VIEWER' })));
const nodoc2 = G('nodoc2', 'n2@x.com');
await t('no-doc user cannot self-create STAFF', assertFails(setDoc(doc(nodoc2, 'users/nodoc2'), { role: 'STAFF' })));
await t('no-doc user cannot edit others (old default EMPLOYEE)', assertFails(updateDoc(doc(nodoc2, 'users/rich'), { points: 999999 })));

const staffA = G('staffA', 's@x.com');
await t('staff can edit own name keeping STAFF role', assertSucceeds(updateDoc(doc(staffA, 'users/staffA'), { name: 'lee' })));
await t('staff cannot self-promote to SUPER_ADMIN', assertFails(updateDoc(doc(staffA, 'users/staffA'), { role: 'SUPER_ADMIN' })));
await t('staff cannot edit other users', assertFails(updateDoc(doc(staffA, 'users/rich'), { points: 999 })));
await t('staff cannot change merchant fee', assertFails(updateDoc(doc(staffA, 'merchants/B'), { feeBps: 0 })));

const ceoA = G('ceoA', 'a@x.com');
await t('ceo A cannot read B attendance', assertFails(getDoc(doc(ceoA, 'nvr_attendance/b1'))));
await t('ceo B reads own attendance', assertSucceeds(getDoc(doc(G('ceoB', 'b@x.com'), 'nvr_attendance/b1'))));
await t('ceo A is not platform admin (admins)', assertFails(setDoc(doc(ceoA, 'admins/ceoA'), { x: 1 })));
await t('ceo A cannot read B employees', assertFails(getDoc(doc(ceoA, 'employees/empB1'))));
await t('ceo A cannot create employee in B', assertFails(addDoc(collection(ceoA, 'employees'), { tenantId: 'B', contact: 'z@x.com' })));
await t('ceo A creates employee in A', assertSucceeds(addDoc(collection(ceoA, 'employees'), { tenantId: 'A', contact: 'z@x.com' })));
await t('ceo A links member as STAFF of A (employees.js)', assertSucceeds(setDoc(doc(ceoA, 'users/member'), { email: 'm@x.com', role: 'STAFF', status: '승인완료', position: 'p', department: '', merchantId: 'A', tenantId: 'A', tenant_id: 'A', storeName: 'S', employeeDocId: 'e', updatedAt: new Date() }, { merge: true })));
await t('ceo A revokes member (employees.js delete)', assertSucceeds(updateDoc(doc(ceoA, 'users/member'), { role: 'VIEWER', status: '대기중', position: '일반 회원', merchantId: null, tenantId: null, updatedAt: new Date() })));
await t('ceo A cannot make someone CEO', assertFails(updateDoc(doc(ceoA, 'users/rich'), { role: 'CEO' })));
await t('ceo A cannot link into B', assertFails(updateDoc(doc(ceoA, 'users/rich'), { role: 'STAFF', merchantId: 'B', tenantId: 'B' })));
await t('ceo A cannot touch B ceo', assertFails(updateDoc(doc(ceoA, 'users/ceoB'), { role: 'VIEWER' })));
await t('ceo A cannot edit member points', assertFails(updateDoc(doc(ceoA, 'users/rich'), { points: 999 })));

// employee first login self-claim (auth.js fail-safe)
const newEmp = G('newEmp', 'new@x.com');
const q = await getDocs(query(collection(newEmp, 'employees'), where('contact', '==', 'new@x.com')));
await t('employee can find own employee doc by email', Promise.resolve(q.size === 1 ? 1 : (() => { throw new Error('size ' + q.size); })()));
await t('employee self-claims STAFF of A', assertSucceeds(setDoc(doc(newEmp, 'users/newEmp'), { email: 'new@x.com', role: 'STAFF', status: '승인완료', position: 'p', department: '', merchantId: 'A', tenantId: 'A', tenant_id: 'A', storeName: 'S', employeeDocId: 'empA1' }, { merge: true })));
const fake = G('fake', 'fake@x.com');
await t('stranger cannot claim someone else employee doc', assertFails(setDoc(doc(fake, 'users/fake'), { role: 'STAFF', merchantId: 'A', tenantId: 'A', tenant_id: 'A', employeeDocId: 'empA1' })));
const unv = U('unv', 'eb@x.com');
await t('unverified email cannot claim', assertFails(setDoc(doc(unv, 'users/unv'), { role: 'STAFF', merchantId: 'B', tenantId: 'B', tenant_id: 'B', employeeDocId: 'empB1' })));
await t('claim cannot pick other tenant', assertFails(setDoc(doc(G('eb', 'eb@x.com'), 'users/eb'), { role: 'STAFF', merchantId: 'A', tenantId: 'A', tenant_id: 'A', employeeDocId: 'empB1' })));

// operator
const op = G('opuid', 'daguri75@gmail.com');
await t('operator (verified) full access', assertSucceeds(getDoc(doc(op, 'nvr_attendance/b1'))));
await t('operator email unverified gets nothing', assertFails(getDoc(doc(U('opuid2', 'daguri75@gmail.com'), 'nvr_attendance/b1'))));
await t('operator can set any role', assertSucceeds(updateDoc(doc(op, 'users/rich'), { role: 'CEO' })));

// BestClubVN flows
const guest = G('guest1', 'g@x.com');
await t('guest play creates role user', assertSucceeds(setDoc(doc(guest, 'users/guest1'), { displayName: 'Guest#1', isAnonymous: true, role: 'user' })));
const merchN = G('merchN', 'mn@x.com');
await t('numeric merchantId merchant reads own nvr', assertSucceeds(getDoc(doc(merchN, 'nvr_attendance/n1'))));
await t('numeric merchantId merchant cannot read B nvr', assertFails(getDoc(doc(merchN, 'nvr_attendance/b1'))));
await t('numeric merchant creates own employee', assertSucceeds(addDoc(collection(merchN, 'employees'), { tenantId: '1791002036', contact: 'q@x.com' })));
await t('merchant creates coupon campaign (isStaff)', assertSucceeds(setDoc(doc(merchN, 'coupon_campaigns/c1'), { merchantId: 1791002036 })));
await t('merchant is not admin (notices)', assertFails(setDoc(doc(merchN, 'notices/n1'), { t: 1 })));
await t('admin approves merchant (admin-approve.js)', assertSucceeds(setDoc(doc(op, 'users/applicant'), { merchantId: 1795000000, role: 'merchant' }, { merge: true })));
await t('applicant cannot self-approve', assertFails(setDoc(doc(G('applicant', 'ap@x.com'), 'users/applicant'), { role: 'CEO' }, { merge: true })));

// ERP collections & coupons
await t('member cannot read financeRecords', assertFails(getDoc(doc(member, 'financeRecords/f2'))));
await t('staff reads financeRecords', assertSucceeds(getDoc(doc(staffA, 'financeRecords/f2'))));
await t('merchant (numeric) writes materials', assertSucceeds(setDoc(doc(merchN, 'materials/x1'), { name: 'onion' })));
await t('member cannot write materials', assertFails(setDoc(doc(member, 'materials/x2'), { name: 'onion' })));
await t('anonymous cannot create coupon', assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'user_coupons/x'), { userId: 'z' })));
await t('member cannot read others coupon', assertFails(getDoc(doc(G('other', 'o@x.com'), 'user_coupons/uc1'))));
await t('member reads own coupon', assertSucceeds(getDoc(doc(member, 'user_coupons/uc1'))));
await t('member can check missing coupon doc', assertSucceeds(getDoc(doc(member, 'user_coupons/UC_REV_c_member'))));
await t('staff (merchant) verifies coupon', assertSucceeds(updateDoc(doc(merchN, 'user_coupons/uc1'), { status: 'USED' })));
await t('member cannot edit menu', assertFails(updateDoc(doc(member, 'menus/m1'), { name: 'x' })));
await t('staff edits menu', assertSucceeds(updateDoc(doc(staffA, 'menus/m1'), { name: 'y' })));
await t('member cannot change product price', assertFails(updateDoc(doc(member, 'merchant_products/p1'), { price: 1 })));
await t('member updates group-buy count', assertSucceeds(updateDoc(doc(member, 'merchant_products/p1'), { group_buy_current: 2, 'group_buy.current_count': 2 })));

// recipes & deductions
await t('staff writes recipe', assertSucceeds(setDoc(doc(staffA, 'menu_recipes/p1'), { productId: 'p1', items: [] })));
await t('member cannot read recipe', assertFails(getDoc(doc(member, 'menu_recipes/p1'))));
await t('staff records deduction', assertSucceeds(setDoc(doc(staffA, 'sales_deductions/pos_A_1'), { source: 'pos' })));
await t('staff cannot rewrite deduction', assertFails(updateDoc(doc(staffA, 'sales_deductions/pos_A_1'), { source: 'x' })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
