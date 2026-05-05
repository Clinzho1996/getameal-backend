import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

try {
	// ===============================
	// ENV METHOD (PRODUCTION)
	// ===============================
	if (process.env.FIREBASE_SERVICE_ACCOUNT) {
		console.log("📦 Loading Firebase credentials from ENV");

		serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

		if (serviceAccount.private_key) {
			serviceAccount.private_key = serviceAccount.private_key.replace(
				/\\n/g,
				"\n",
			);
		}
	}

	// ===============================
	// FILE METHOD (LOCAL DEV)
	// ===============================
	else {
		console.log("📁 Loading Firebase credentials from file");

		const serviceAccountPath = path.resolve(
			__dirname,
			"serviceAccountKey.json",
		);

		serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
	}

	// ===============================
	// VALIDATION
	// ===============================
	if (!serviceAccount?.private_key || !serviceAccount?.client_email) {
		throw new Error("Invalid Firebase service account structure");
	}

	console.log("✅ Firebase credentials loaded successfully");
} catch (err) {
	console.error("❌ Firebase credential load failed:", err.message);
}

console.log("CLIENT EMAIL:", serviceAccount.client_email);
console.log("PROJECT ID:", serviceAccount.project_id);
console.log("HAS PRIVATE KEY:", !!serviceAccount.private_key);

if (!admin.apps.length && serviceAccount) {
	admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
	});

	console.log("🔥 Firebase initialized successfully");
} else {
	console.warn("⚠️ Firebase NOT initialized");
}

export default admin;
