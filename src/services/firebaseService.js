import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

// PRODUCTION (Render)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
	try {
		serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
		console.log(
			"FIREBASE_SERVICE_ACCOUNT EXISTS:",
			!!process.env.FIREBASE_SERVICE_ACCOUNT,
		);
		console.log(
			"RAW VALUE:",
			process.env.FIREBASE_SERVICE_ACCOUNT?.slice(0, 50),
		);
		console.log("RAW ENV TYPE:", typeof process.env.FIREBASE_SERVICE_ACCOUNT);
		console.log(
			"RAW ENV START:",
			process.env.FIREBASE_SERVICE_ACCOUNT?.slice(0, 80),
		);
	} catch (err) {
		console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON");
	}
}

// LOCAL DEVELOPMENT
else {
	try {
		const serviceAccountPath = path.join(
			__dirname,
			"../config/serviceAccountKey.json",
		);

		if (fs.existsSync(serviceAccountPath)) {
			serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
		} else {
			console.warn("serviceAccountKey.json not found. Firebase auth disabled.");
		}
	} catch (err) {
		console.error("Failed to load Firebase service account:", err.message);
	}
}

// Initialize Firebase only if credentials exist
let firebaseApp = null;

if (serviceAccount) {
	firebaseApp = admin.apps.length
		? admin.app()
		: admin.initializeApp({
				credential: admin.credential.cert(serviceAccount),
			});
}

// Verify Firebase ID Token
export const verifyFirebaseToken = async (idToken) => {
	try {
		if (!firebaseApp) {
			throw new Error("Firebase not initialized");
		}

		const decoded = await admin.auth().verifyIdToken(idToken);
		return decoded;
	} catch (error) {
		throw new Error("Invalid Firebase token");
	}
};

export default firebaseApp;
