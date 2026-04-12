// scripts/generateTestToken.js
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase service account
const serviceAccountPath = path.join(
	__dirname,
	"../config/serviceAccountKey.json",
);

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));

// Initialize Firebase
const firebaseApp = admin.apps.length
	? admin.app()
	: admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});

const generateTestToken = async () => {
	try {
		// Create a test user
		let user;
		const testEmail = "testuser@example.com";

		try {
			user = await admin.auth().getUserByEmail(testEmail);
			console.log("✓ Using existing user:", user.uid);
		} catch (error) {
			user = await admin.auth().createUser({
				email: testEmail,
				displayName: "Test User",
				emailVerified: true,
			});
			console.log("✓ Created new user:", user.uid);
		}

		// Generate custom token (acts as ID token for testing)
		const customToken = await admin.auth().createCustomToken(user.uid);

		console.log("\n🔑 TEST ID TOKEN (for Postman):");
		console.log("=========================================");
		console.log(customToken);
		console.log("=========================================");

		console.log("\n📋 Postman Request:");
		console.log("POST {{base_url}}/api/auth/social-auth");
		console.log("Content-Type: application/json");
		console.log("\nBody:");
		console.log(
			JSON.stringify(
				{
					idToken: customToken,
					name: "Test User",
					email: testEmail,
				},
				null,
				2,
			),
		);

		return customToken;
	} catch (error) {
		console.error("Error generating token:", error.message);
	}
};

generateTestToken();
