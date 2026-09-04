const admin = require('firebase-admin');
const serviceAccount = require('./service_account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();
async function run() {
    try {
        const usersRef = db.collection('users');
        const mentorQuery = await usersRef.where('email', '==', 'daguri75@gmail.com').get();
        if (mentorQuery.empty) {
            console.log('Mentor daguri75@gmail.com not found');
            return;
        }
        const mentorDoc = mentorQuery.docs[0];
        const mentorUid = mentorDoc.id;
        console.log('Mentor UID:', mentorUid);
        
        const menteeQuery = await usersRef.where('email', '==', 'kfu134252@gmail.com').get();
        if (menteeQuery.empty) {
            console.log('Mentee kfu134252@gmail.com not found');
            return;
        }
        const menteeDoc = menteeQuery.docs[0];
        const menteeUid = menteeDoc.id;
        console.log('Mentee UID:', menteeUid);
        
        await menteeDoc.ref.update({
            mentorUid: mentorUid,
            mentorEmail: 'daguri75@gmail.com',
            createdAt: admin.firestore.FieldValue.serverTimestamp() // optional
        });
        console.log('Success linked');
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();