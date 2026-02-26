import admin from "firebase-admin";
import fs from "fs";
import path from "path";

const serviceAccount = JSON.parse(
	fs.readFileSync(path.resolve("src/config/serviceAccountKey.json"), "utf8"),
);

// Initialize Firebase
if (!admin.apps.length) {
	admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
	});
}
// Push notification helper
export const sendPushNotification = async (token, title, body, data = {}) => {
	const message = {
		notification: { title, body },
		data,
		token,
	};
	try {
		await admin.messaging().send(message);
		console.log("Notification sent successfully");
	} catch (err) {
		console.error("Notification error:", err.message);
	}
};

// Emit order update through Socket.io
export const emitOrderUpdate = (order) => {
	// assumes you have your socket.io server instance exported as io
	import("../server.js").then(({ io }) => {
		io.to(order.userId.toString()).emit("orderUpdate", order);
	});
};

// Send generic notification (push + optional email/SMS)
export const sendNotification = async (userId, message) => {
	// TODO: fetch user's device token from DB
	const token = "DEVICE_TOKEN_FROM_DB";
	await sendPushNotification(token, "Getameal Update", message);
};
