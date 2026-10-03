import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, limit } from "firebase/firestore";

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
    const q = query(collection(db, "users"), limit(5));
    const snap = await getDocs(q);
    console.log("Total users found:", snap.size);
    snap.forEach(doc => {
        console.log(doc.id, "=>", doc.data().email, doc.data().name);
    });
}

check();
