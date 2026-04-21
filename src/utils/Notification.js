import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
	serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
	try {
		const serviceAccountPath = path.resolve(
			__dirname,
			"serviceAccountKey.json",
		);

		serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
	} catch (err) {
		console.error("Failed to load Firebase service account key.");
	}
}

if (serviceAccount && !admin.apps.length) {
	admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
	});
}

export const emitOrderUpdate = (order) => {
	import("../server.js").then(({ io }) => {
		io.to(order.userId.toString()).emit("orderUpdate", order);
	});
};

export const sendNotification = async (userId, message) => {
	const token = "DEVICE_TOKEN_FROM_DB";
	await sendPushNotification(token, "Getameal Update", message);
};
