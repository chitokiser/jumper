const admin = require('firebase-admin');
var serviceAccount = require("./jumper-b15aa-firebase-adminsdk-h4wcb-6eaf43b171.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkOwner() {
    try {
        const merchSnap = await db.collection('merchants').doc('2').get();
        if (!merchSnap.exists) {
            console.log("Merchant 2 missing");
            return;
        }
        const mData = merchSnap.data();
        console.log("Merchant 2 ownerUid:", mData.ownerUid);

        if (mData.ownerUid) {
            const uSnap = await db.collection('users').doc(mData.ownerUid).get();
            console.log("Owner User Email:", uSnap.exists ? uSnap.data().email : "DOES NOT EXIST");
        }
    } catch (e) {
        console.error(e);
    }
}

checkOwner();
