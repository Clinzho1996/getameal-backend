// controllers/paymentController.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

// Handle successful payment
export const handleSuccessfulPayment = async (data) => {
	const orderId = data.metadata?.orderId;

	let order = null;

	if (orderId) {
		order = await Order.findById(orderId);
	}

	// fallback (safety)
	if (!order) {
		order = await Order.findOne({
			paymentReference: data.reference,
		});
	}

	if (!order || order.paymentStatus === "paid") return;

	order.paymentStatus = "paid";
	order.status = "confirmed";
	order.paymentReference = data.reference;

	await order.save();
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
