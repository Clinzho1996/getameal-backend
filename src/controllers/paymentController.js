// controllers/paymentController.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

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
			return;
		}

		// ✅ Update order
		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = data.reference;

		await order.save();

		console.log("✅ Payment applied via webhook:", order._id);
	} catch (error) {
		console.error("Webhook processing error:", error.message);
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

	await WalletTransaction.create({
		cookId: cook._id,
		type: "debit",
		amount: order.totalAmount,
		reference: order._id.toString(),
	});

	console.log(`Cook ${cook._id} debited: ${order.totalAmount}`);
};
