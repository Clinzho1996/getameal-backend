// backend/config/firebase.js
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount = null;

try {
	// For production on Render - use GOOGLE_APPLICATION_CREDENTIALS
	if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
		console.log("📝 Using GOOGLE_APPLICATION_CREDENTIALS...");
		if (!admin.apps.length) {
			admin.initializeApp({
				credential: admin.credential.applicationDefault(),
			});
			console.log(
				"✅ Firebase initialized with application default credentials",
			);
		}
	}
	// For Render - use individual env vars (more reliable)
	else if (
		process.env.FIREBASE_PROJECT_ID &&
		process.env.FIREBASE_PRIVATE_KEY
	) {
		console.log("📝 Using individual Firebase environment variables...");
		serviceAccount = {
			type: "service_account",
			project_id: process.env.FIREBASE_PROJECT_ID,
			private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
			private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
			client_email: process.env.FIREBASE_CLIENT_EMAIL,
			client_id: process.env.FIREBASE_CLIENT_ID || "",
			auth_uri: "https://accounts.google.com/o/oauth2/auth",
			token_uri: "https://oauth2.googleapis.com/token",
			auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
			client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL || "",
			universe_domain: "googleapis.com",
		};

		if (!admin.apps.length) {
			admin.initializeApp({
				credential: admin.credential.cert(serviceAccount),
			});
			console.log("✅ Firebase initialized with individual env vars");
		}
	}
	// For local development - use file
	else {
		const serviceAccountPath = path.resolve(
			__dirname,
			"ServiceAccountKey.json",
		);
		console.log(
			`📁 Attempting to load Firebase from file: ${serviceAccountPath}`,
		);

		if (fs.existsSync(serviceAccountPath)) {
			serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

			if (!admin.apps.length) {
				admin.initializeApp({
					credential: admin.credential.cert(serviceAccount),
				});
				console.log("✅ Firebase loaded from ServiceAccountKey.json");
			}
		} else {
			throw new Error("No Firebase credentials found");
		}
	}

	if (admin.apps.length) {
		console.log(`📱 Project: ${admin.apps[0].options.projectId || "unknown"}`);
		console.log("🔥 Firebase initialized successfully");

		// Test FCM permissions
		try {
			const messaging = admin.messaging();
			console.log("✅ FCM messaging service is available");
		} catch (fcmError) {
			console.error("❌ FCM not available:", fcmError.message);
		}
	}
} catch (error) {
	console.error("❌ Firebase initialization error:", error.message);
}

export const verifyFirebaseToken = async (idToken) => {
	try {
		if (!admin.apps.length) {
			throw new Error("Firebase not initialized");
		}
		const decoded = await admin.auth().verifyIdToken(idToken);
		return decoded;
	} catch (error) {
		console.error("Token verification failed:", error.message);
		throw new Error(`Invalid Firebase token: ${error.message}`);
	}
};

export default admin;
