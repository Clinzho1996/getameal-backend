// controllers/callController.js
import pkg from "agora-access-token";
const { RtcRole, RtcTokenBuilder } = pkg;

import Order from "../models/Order.js";

// Generate Agora token for a call between user and cook
export const generateCallToken = async (req, res) => {
	try {
		const { orderId, role } = req.body;
		const requestingUserId = req.user._id;

		if (!orderId || !role) {
			return res.status(400).json({ message: "orderId and role are required" });
		}

		// Fetch order and populate user & cook
		const order = await Order.findById(orderId).populate("userId cookId");
		if (!order) return res.status(404).json({ message: "Order not found" });

		// Ensure the requesting user matches the role
		if (
			(role === "user" &&
				order.userId._id.toString() !== requestingUserId.toString()) ||
			(role === "cook" &&
				order.cookId._id.toString() !== requestingUserId.toString())
		) {
			return res.status(403).json({ message: "Not authorized for this role" });
		}

		// Define a unique channel per order
		const channelName = `order_${order._id}`;

		// Generate numeric UID from user ID (6 hex digits from ObjectId)
		const uid = parseInt(requestingUserId.toString().slice(-6), 16);

		// Both roles can publish audio/video
		const agoraRole = RtcRole.PUBLISHER;

		// Token valid for 1 hour
		const expirationTime = Math.floor(Date.now() / 1000) + 3600;

		const token = RtcTokenBuilder.buildTokenWithUid(
			process.env.AGORA_APP_ID,
			process.env.AGORA_CERT,
			channelName,
			uid,
			agoraRole,
			expirationTime,
		);

		res.json({
			token,
			channelName,
			uid,
			expiresAt: expirationTime,
		});
	} catch (error) {
		console.error("Error generating call token:", error.message);
		res.status(500).json({ message: "Failed to generate call token" });
	}
};
