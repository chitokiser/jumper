import admin from "firebase-admin";
import { config } from "../config.js";

function createCredential() {
  if (config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey) {
    return admin.credential.cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    });
  }
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: createCredential(),
    projectId: config.firebase.projectId || undefined,
    storageBucket: config.firebase.storageBucket || undefined,
  });
}

export const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
