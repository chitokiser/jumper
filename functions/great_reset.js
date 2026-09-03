const admin = require('firebase-admin');
const serviceAccount = require('./service_account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteCollection(collectionPath) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(500);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();
    const batchSize = snapshot.size;
    if (batchSize === 0) {
        resolve();
        return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}

async function resetUsers() {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    let batches = [];
    let currentBatch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        currentBatch.update(doc.ref, {
            pointBalance: 0,
            pointBalanceVnd: 0,
            onChain: admin.firestore.FieldValue.delete()
        });
        count++;
        if (count % 500 === 0) {
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
        }
    });
    if (count % 500 !== 0) {
        batches.push(currentBatch.commit());
    }
    await Promise.all(batches);
    console.log(`Reset ${count} users to 0 balances.`);
}

async function resetBattlePlayers() {
    const bpRef = db.collection('battle_players');
    const snapshot = await bpRef.get();
    let batches = [];
    let currentBatch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        currentBatch.update(doc.ref, {
            gsExp: 0,
            gsLevel: 1
        });
        count++;
        if (count % 500 === 0) {
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
        }
    });
    if (count % 500 !== 0) {
        batches.push(currentBatch.commit());
    }
    await Promise.all(batches);
    console.log(`Reset ${count} battle_players to LV1 / 0 EXP.`);
}

async function resetSystemConfigs() {
    await db.collection('jackpot_config').doc('current').set({
        jackpotAccVnd: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Reset jackpot_config -> 0');

    await db.collection('platform_config').doc('revenue').set({
        totalRevenueVnd: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Reset platform_config -> 0');
}

async function run() {
    try {
        console.log('Starting Great Reset...');

        // Purging collections
        console.log('Purging transactions...');
        await deleteCollection('transactions');
        console.log('Purging jackpot_transactions...');
        await deleteCollection('jackpot_transactions');
        console.log('Purging jackpot_wins...');
        await deleteCollection('jackpot_wins');
        console.log('Purging deposits...');
        await deleteCollection('deposits');
        console.log('Purging k_culture_balances...');
        await deleteCollection('k_culture_balances');
        console.log('Purging admin_deposits...');
        await deleteCollection('admin_deposits');
        console.log('Purging fiat_deposits...');
        await deleteCollection('fiat_deposits');

        // Zero-out balances
        console.log('Resetting Users...');
        await resetUsers();

        console.log('Resetting Battle Players...');
        await resetBattlePlayers();

        console.log('Resetting System Configs...');
        await resetSystemConfigs();

        console.log('GREAT RESET SUCCESSFUL!');
        process.exit(0);
    } catch (e) {
        console.error('Reset Failed:', e);
        process.exit(1);
    }
}

run();
