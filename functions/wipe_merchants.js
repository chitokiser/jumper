const admin = require('firebase-admin');
admin.initializeApp({ projectId: "jumper-b15aa" });
const db = admin.firestore();

async function deleteCollection(collectionPath) {
    const colRef = db.collection(collectionPath);
    const qs = await colRef.get();
    let count = 0;
    for (let doc of qs.docs) {
        await doc.ref.delete();
        count++;
    }
    console.log(`Deleted ${count} documents from ${collectionPath}`);
}

async function run() {
    console.log("Starting deletion...");
    try {
        await deleteCollection('merchants');
        await deleteCollection('guideApplications');
        await deleteCollection('guides');
        console.log("All merchant data reset successfully.");
    } catch (e) {
        console.error("Error deleting data: ", e);
    }
}

run();
