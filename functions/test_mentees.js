const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'jumper-b15aa' });

const { getMyMentees } = require('./handlers/onboarding');

async function test() {
    try {
        const res = await getMyMentees('someUid');
        console.log(res);
    } catch (err) {
        console.error("ERROR:", err);
    }
}
test();
