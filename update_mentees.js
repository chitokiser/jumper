const fs = require('fs');

let js = fs.readFileSync('functions/handlers/onboarding.js', 'utf8');

const s = `  // ── 1. Firestore에서 onChain.mentorAddress == myAddress 인 사용자 조회
  // (등록 시 저장되므로 블록 범위 제한 없이 전체 조회 가능)
  const [fsSnapLower, fsSnapChecksum] = await Promise.all([
    db.collection('users').where('onChain.mentorAddress', '==', myLowerAddr).get(),
    db.collection('users').where('onChain.mentorAddress', '==', myChecksumAddr).get(),
  ]);

  const menteeAddrSet = new Set();
  const addrToDoc     = {};

  [...fsSnapLower.docs, ...fsSnapChecksum.docs].forEach((d) => {
    const walletAddr = d.data()?.wallet?.address;
    if (!walletAddr) return;
    try {
      const cs = ethers.getAddress(walletAddr);
      if (!menteeAddrSet.has(cs)) {
        menteeAddrSet.add(cs);
        addrToDoc[cs.toLowerCase()] = d;
      }
    } catch (_) {}
  });`;

const r = `  // ── 1. Firestore에서 onChain.mentorAddress == myAddress 인 사용자 조회
  // (등록 시 저장되므로 블록 범위 제한 없이 전체 조회 가능) + 이메일/UID 매칭 추가
  const myEmail = userData.email || '';
  
  const queryPromises = [];
  if (myLowerAddr) queryPromises.push(db.collection('users').where('onChain.mentorAddress', '==', myLowerAddr).get());
  if (myChecksumAddr) queryPromises.push(db.collection('users').where('onChain.mentorAddress', '==', myChecksumAddr).get());
  if (myEmail) {
      queryPromises.push(db.collection('users').where('mentorAddressInput', '==', myEmail).get());
      queryPromises.push(db.collection('users').where('mentorEmail', '==', myEmail).get());
  }
  queryPromises.push(db.collection('users').where('mentorUid', '==', uid).get()); // Just in case mentorUid is used
  
  const results = await Promise.all(queryPromises);

  const menteeAddrSet = new Set();
  const addrToDoc     = {};
  const menteeDocs = []; // Also keep track of doc even if no wallet address

  results.forEach(snap => {
    snap.docs.forEach((d) => {
      menteeDocs.push(d); // store all matched mentees
      const walletAddr = d.data()?.wallet?.address;
      if (!walletAddr) return;
      try {
        const cs = ethers.getAddress(walletAddr);
        if (!menteeAddrSet.has(cs)) {
          menteeAddrSet.add(cs);
          addrToDoc[cs.toLowerCase()] = d;
        }
      } catch (_) {}
    });
  });`;

const s2 = `  // ── 3. 현재 온체인 members(address).mentor 확인 — 멘토가 바뀐 주소 제거
  const currentMentees = [];
  await Promise.all([...menteeAddrSet].map(async (addr) => {
    try {
      const m = await platform.members(addr);
      if (ethers.getAddress(m.mentor) === myChecksumAddr) {
        currentMentees.push(addr);
      }
    } catch (_) {}
  }));

  if (currentMentees.length === 0) return { mentees: [], myAddress: myChecksumAddr };`;

const r2 = `  // ── 3. 현재 온체인 members(address).mentor 확인 — 멘토가 바뀐 주소 제거 (Web2 매칭은 예외)
  const currentMentees = [];
  await Promise.all([...menteeAddrSet].map(async (addr) => {
    try {
      const m = await platform.members(addr);
      if (ethers.getAddress(m.mentor) === myChecksumAddr) {
        currentMentees.push(addr);
      }
    } catch (_) {}
  }));

  // But we MUST also include the mentees matched by email/uid!
  menteeDocs.forEach(d => {
      const addr = d.data()?.wallet?.address;
      // If it doesn't have an address or wasn't matched onchain, just append it if not already in list
      if (!addr || !currentMentees.includes(ethers.getAddress(addr))) {
          // If we matched them via email or UID, we trust it over onchain!
          if (d.data().mentorAddressInput === myEmail || d.data().mentorEmail === myEmail || d.data().mentorUid === uid) {
              if (addr) currentMentees.push(ethers.getAddress(addr));
              // else we process them without an address later
              addrToDoc[addr ? addr.toLowerCase() : d.id] = d;
          }
      }
  });

  if (currentMentees.length === 0 && menteeDocs.length === 0) return { mentees: [], myAddress: myChecksumAddr };`;

const s3 = `  const mentees = currentMentees.map((addr) => {
    const fsDoc = addrToDoc[addr.toLowerCase()];
    const data  = fsDoc?.data() || {};
    return {
      uid:          fsDoc?.id || null,
      name:         data.name || addr.slice(0, 6) + '...' + addr.slice(-4),
      address:      addr,
      registeredAt: data.onChain?.registeredAt?.toMillis?.() ?? null,
    };
  });`;

const r3 = `  const mentees = [];
  const processedUids = new Set();
  
  // add those with addresses
  currentMentees.forEach((addr) => {
    const fsDoc = addrToDoc[addr.toLowerCase()];
    if (fsDoc) processedUids.add(fsDoc.id);
    const data  = fsDoc?.data() || {};
    mentees.push({
      uid:          fsDoc?.id || null,
      name:         data.name || addr.slice(0, 6) + '...' + addr.slice(-4),
      address:      addr,
      registeredAt: data.onChain?.registeredAt?.toMillis?.() ?? data.registeredAt?.toMillis?.() ?? null,
    });
  });

  // add those without addresses (pure Web2 mentees)
  menteeDocs.forEach(d => {
      if (!processedUids.has(d.id)) {
          processedUids.add(d.id);
          const data = d.data() || {};
          mentees.push({
              uid: d.id,
              name: data.name || (data.email ? data.email.split('@')[0] : '유저'),
              address: null,
              registeredAt: data.registeredAt?.toMillis?.() ?? null,
          });
      }
  });`;

if (js.includes(s) && js.includes(s2) && js.includes(s3)) {
    js = js.replace(s, r);
    js = js.replace(s2, r2);
    js = js.replace(s3, r3);

    // One more fix: if myAddress is missing, we shouldn't exit early!
    js = js.replace(`  const myAddress = userData?.wallet?.address;\n  if (!myAddress) return { mentees: [], myAddress: null };`, `  const myAddress = userData?.wallet?.address;\n  // don't return early! we can still find mentees by email/uid`);
    js = js.replace(`const myLowerAddr    = myChecksumAddr.toLowerCase();`, `const myLowerAddr = myAddress ? myChecksumAddr.toLowerCase() : null;`);
    js = js.replace(`const myChecksumAddr = ethers.getAddress(myAddress);`, `const myChecksumAddr = myAddress ? ethers.getAddress(myAddress) : null;`);

    fs.writeFileSync('functions/handlers/onboarding.js', js, 'utf8');
    console.log("Updated getMyMentees algorithm");
} else {
    console.log("Could not find blocks");
}
