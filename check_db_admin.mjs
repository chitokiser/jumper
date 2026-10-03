import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

// If there's no service account key, we can't use admin SDK. Is there a service account key?
