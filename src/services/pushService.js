// backend/services/pushService.js
import admin from "../config/firebase.js";
import User from "../models/User.js";

// Send push notification to a specific user
export const sendPushToUser = async (userId, title, body, data = {}) => {
	try {
		console.log(`📱 Sending push to user: ${userId}`);
		console.log(`Title: ${title}`);
		console.log(`Body: ${body}`);

		const user = await User.findById(userId).select(
			"pushTokens email fullName",
		);

		if (!user) {
			console.log(`❌ User not found: ${userId}`);
			return { success: false, message: "User not found" };
		}

		if (!user.pushTokens || user.pushTokens.length === 0) {
			console.log(`❌ No push tokens for user: ${user.email}`);
			return { success: false, message: "No device tokens" };
		}

		console.log(
			`✅ Found ${user.pushTokens.length} push token(s) for ${user.email}`,
		);

		// Extract valid token strings
		const tokens = user.pushTokens.map((t) => t.token).filter(Boolean);

		if (tokens.length === 0) {
			console.log("❌ No valid tokens after extraction");
			return { success: false, message: "No valid tokens" };
		}

		console.log(`📤 Sending ${tokens.length} push notification(s)...`);

		const message = {
			notification: {
				title,
				body,
			},
			data: {
				...Object.fromEntries(
					Object.entries(data).map(([k, v]) => [k, String(v)]),
				),
				userId: user._id.toString(),
				timestamp: new Date().toISOString(),
			},
			tokens,
		};

		const response = await admin.messaging().sendEachForMulticast(message);

		const errors = [];

		response.responses.forEach((res, index) => {
			if (!res.success) {
				const errorMsg = res.error?.message || "Unknown error";

				console.log(`❌ Token error: ${errorMsg}`);

				errors.push({
					token: tokens[index],
					error: errorMsg,
				});

				// Remove invalid tokens
				if (
					errorMsg.includes("registration-token-not-registered") ||
					errorMsg.includes("invalid-registration-token")
				) {
					console.log(`🗑 Removing invalid token: ${tokens[index]}`);

					User.findByIdAndUpdate(user._id, {
						$pull: { pushTokens: { token: tokens[index] } },
					}).catch(console.error);
				}
			}
		});

		console.log(
			`✅ Push sent: ${response.successCount} successful, ${response.failureCount} failed`,
		);

		return {
			success: true,
			sent: response.successCount,
			failed: response.failureCount,
			errors: errors.length > 0 ? errors : undefined,
		};
	} catch (error) {
		console.error("❌ Error sending push notification:", error);
		throw error;
	}
};

// Save push token for user (updated for pushTokens)
export const saveDeviceToken = async (
	userId,
	token,
	deviceType,
	deviceId = null,
) => {
	try {
		console.log(`💾 Saving push token for user: ${userId}`);

		const user = await User.findById(userId);

		if (!user) {
			throw new Error("User not found");
		}

		// Initialize pushTokens array if it doesn't exist
		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// Remove this token from any other user first (cleanup)
		await User.updateMany(
			{ "pushTokens.token": token },
			{ $pull: { pushTokens: { token: token } } },
		);

		// Check if token already exists for this user
		const existingToken = user.pushTokens.find((t) => t.token === token);

		if (existingToken) {
			existingToken.lastUsed = new Date();
			existingToken.platform = deviceType;
			if (deviceId) existingToken.deviceId = deviceId;
		} else {
			user.pushTokens.push({
				token,
				platform: deviceType,
				deviceId: deviceId,
				lastUsed: new Date(),
				createdAt: new Date(),
			});
		}

		await user.save();
		console.log(`✅ Push token saved for ${user.email}`);

		return user;
	} catch (error) {
		console.error("Error saving push token:", error);
		throw error;
	}
};

// Remove push token
export const removeDeviceToken = async (userId, token) => {
	try {
		const result = await User.findByIdAndUpdate(
			userId,
			{ $pull: { pushTokens: { token: token } } },
			{ new: true },
		);

		console.log(`✅ Push token removed for user ${userId}`);
		return result;
	} catch (error) {
		console.error("Error removing push token:", error);
		throw error;
	}
};

// Remove all push tokens for a user
export const removeAllDeviceTokens = async (userId) => {
	try {
		const result = await User.findByIdAndUpdate(
			userId,
			{ $set: { pushTokens: [] } },
			{ new: true },
		);

		console.log(`✅ All push tokens removed for user ${userId}`);
		return result;
	} catch (error) {
		console.error("Error removing all push tokens:", error);
		throw error;
	}
};

export const sendPush = async (tokens, { title, body, data = {} }) => {
	try {
		if (!tokens?.length) return { successCount: 0, failureCount: 0 };

		const message = {
			tokens,
			notification: {
				title,
				body,
			},
			data: Object.fromEntries(
				Object.entries(data).map(([k, v]) => [k, String(v)]),
			),
		};

		const response = await admin.messaging().sendEachForMulticast(message);

		return {
			success: true,
			successCount: response.successCount,
			failureCount: response.failureCount,
			responses: response.responses,
		};
	} catch (error) {
		console.error("FCM Send Error:", error);
		throw error;
	}
};
