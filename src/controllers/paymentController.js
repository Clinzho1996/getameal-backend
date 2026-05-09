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

		// ✅ Update order first
		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = data.reference;

		await order.save();
		console.log(`✅ Payment applied via webhook: ${order._id}`);

		// ✅ SEND PUSH NOTIFICATION AFTER ORDER IS SAVED
		// Use await to ensure it completes (but don't block if it fails)
		try {
			console.log(
				`📱 Attempting to send push to customer: ${order.customerId}`,
			);

			const pushResult = await sendPushToUser(
				order.customerId,
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

			await sendNotification({
				userId: order.customerId,
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

		// Re-throw to let webhook handler know it failed
		throw error;
	}
};

// Handle refund
export const handleRefund = async (data) => {
	const order = await Order.findOne({
		paymentReference: data.transaction_reference,
	});
	if (!order) throw new Error("Order not found");

	order.paymentStatus = "refunded";
	order.status = "cancelled";
	await order.save();

	const cook = await User.findById(order.cookId);
	cook.walletBalance -= order.totalAmount;
	await cook.save();

	await sendPushToUser(
		order.customerId,
		"Payment Refunded",
		`Your payment for order ${order._id} has been refunded.`,
		{ orderId: order._id.toString() },
	);

	await WalletTransaction.create({
		cookId: cook._id,
		type: "debit",
		amount: order.totalAmount,
		reference: order._id.toString(),
	});

	console.log(`Cook ${cook._id} debited: ${order.totalAmount}`);
};
