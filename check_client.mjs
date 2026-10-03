import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBETZfUgG4y0YAiYuxSVhwnhpwzVUQ59EI",
    authDomain: "experience-factory-4e167.firebaseapp.com",
    projectId: "experience-factory-4e167",
    storageBucket: "experience-factory-4e167.firebasestorage.app",
    messagingSenderId: "142042867302",
    appId: "1:142042867302:web:7689eca32aaee5d189efa7",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
    try {
        const q1 = query(collection(db, "users"), where("email", "==", "kfu134252@gmail.com"));
        const snap1 = await getDocs(q1);
        console.log("Docs for kfu134252:", snap1.size);
        snap1.forEach(doc => {
            console.log(doc.id, "=>", doc.data());
        });

        const q2 = query(collection(db, "users"), where("email", "==", "daguri75@gmail.com"));
        const snap2 = await getDocs(q2);
        console.log("Docs for daguri75:", snap2.size);
        snap2.forEach(doc => {
            console.log(doc.id, "=>", doc.data());
        });
    } catch (e) {
        console.error("Error querying db:", e.message);
    }
}

check();
