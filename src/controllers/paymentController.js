// controllers/paymentController.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";

// Handle successful payment
export const handleSuccessfulPayment = async (data) => {
	try {
		let order = null;

		// ✅ 1. FIRST: Use metadata (MOST RELIABLE)
		const orderId = data.metadata?.orderId;

		if (orderId) {
			order = await Order.findById(orderId);
		}

		// ✅ 2. FALLBACK: Use reference
		if (!order) {
			order = await Order.findOne({
				paymentReference: data.reference,
			});
		}

		// ❌ If still not found → log it
		if (!order) {
			console.error("❌ Webhook: Order not found", {
				reference: data.reference,
				metadata: data.metadata,
			});
			return;
		}

		// ✅ Prevent double processing
		if (order.paymentStatus === "paid") {
			console.log(`⏭️ Order ${order._id} already marked as paid`);
			return;
		}

		// ✅ Update order
		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = data.reference;
		await order.save();

		console.log(`✅ Payment applied via webhook: ${order._id}`);
		console.log(`👤 Customer ID: ${order.userId}`); // ✅ Use userId instead of customerId

		// ✅ SEND PUSH NOTIFICATION AFTER ORDER IS SAVED
		try {
			console.log(`📱 Attempting to send push to customer: ${order.userId}`);

			const pushResult = await sendPushToUser(
				order.userId, // ✅ CHANGE THIS: Use userId instead of customerId
				"Payment Successful",
				`Your payment for order ${order._id} was successful!`,
				{
					orderId: order._id.toString(),
					amount: order.totalAmount,
					type: "payment_success",
				},
			);

			if (pushResult.success) {
				console.log(
					`✅ Push notification sent to customer for order ${order._id}`,
				);
				console.log(
					`📊 Sent to ${pushResult.sent} device(s), Failed: ${pushResult.failed}`,
				);
			} else {
				console.warn(
					`⚠️ Push notification failed for order ${order._id}: ${pushResult.message}`,
				);
				if (pushResult.errors) {
					console.error("Push errors:", pushResult.errors);
				}
			}

			// Also create in-app notification
			await sendNotification({
				userId: order.userId, // ✅ Use userId here too
				title: "Payment Successful",
				body: `Your payment for order ${order._id} was successful!`,
				type: "payment_success",
				data: { orderId: order._id.toString(), amount: order.totalAmount },
			});
		} catch (pushError) {
			// Don't let push failure break the payment flow
			console.error(
				`❌ Push notification error for order ${order._id}:`,
				pushError.message,
			);
			console.error("Push error details:", pushError);
		}

		return { success: true, order };
	} catch (error) {
		console.error("Webhook processing error:", error.message);
		console.error("Full error:", error);
		throw error;
	}
};

// Handle refund
export const handleRefund = async (data) => {
	try {
		const order = await Order.findOne({
			paymentReference: data.transaction_reference,
		});

		if (!order) throw new Error("Order not found");

		order.paymentStatus = "refunded";
		order.status = "cancelled";
		await order.save();

		// Update cook's wallet
		const cook = await User.findById(order.cookId);
		if (cook) {
			cook.walletBalance = (cook.walletBalance || 0) - order.totalAmount;
			await cook.save();

			await WalletTransaction.create({
				userId: cook._id, // Make sure this matches your schema
				type: "debit",
				amount: order.totalAmount,
				reason: `Refund for order ${order._id}`,
				reference: order._id.toString(),
			});

			console.log(`✅ Cook ${cook._id} debited: ${order.totalAmount}`);
		}

		// Send push notification to customer
		try {
			await sendPushToUser(
				order.userId, // ✅ Use userId
				"Payment Refunded",
				`Your payment for order ${order._id} has been refunded.`,
				{ orderId: order._id.toString() },
			);

			// Also create in-app notification
			await sendNotification({
				userId: order.userId,
				title: "Payment Refunded",
				body: `Your payment for order ${order._id} has been refunded.`,
				type: "payment_refund",
				data: { orderId: order._id.toString() },
			});
		} catch (pushError) {
			console.error(
				`❌ Push notification error for refund:`,
				pushError.message,
			);
		}

		console.log(`✅ Refund processed for order ${order._id}`);
	} catch (error) {
		console.error("Refund processing error:", error.message);
		throw error;
	}
};
