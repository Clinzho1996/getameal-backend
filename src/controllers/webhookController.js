import crypto from "crypto";
import { getIO } from "../config/socket.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const paystackWebhook = async (req, res) => {
	// 1️⃣ Verify signature
	const hash = crypto
		.createHmac("sha512", process.env.PAYSTACK_SECRET)
		.update(JSON.stringify(req.body))
		.digest("hex");

	if (hash !== req.headers["x-paystack-signature"]) {
		return res.sendStatus(401);
	}

	const event = req.body;

	// 2️⃣ Handle successful payment
	if (event.event === "charge.success") {
		const reference = event.data.reference;

		const order = await Order.findOne({ paymentReference: reference });

		if (!order || order.paymentStatus === "paid") {
			return res.sendStatus(200);
		}

		order.paymentStatus = "paid";
		order.status = "confirmed";
		await order.save();

		const cook = await User.findById(order.cookId);

		const commissionRate = 0.1;
		const commission = order.totalAmount * commissionRate;
		const cookAmount = order.totalAmount - commission;

		cook.walletBalance += cookAmount;
		await cook.save();

		await WalletTransaction.create({
			cookId: cook._id,
			type: "credit",
			amount: cookAmount,
			reference: order._id.toString(),
			description: "Order payment",
		});

		const io = getIO();
		io.to(`user_${order.userId}`).emit("order_update", order);
	}

	// 3️⃣ Handle refund processed
	if (event.event === "refund.processed") {
		const transactionRef = event.data.transaction; // original payment reference
		const order = await Order.findOne({ paymentReference: transactionRef });

		if (!order || order.paymentStatus === "refunded") {
			return res.sendStatus(200);
		}

		order.paymentStatus = "refunded";
		order.status = "cancelled";
		order.refundReference = event.data.reference; // Paystack refund reference
		await order.save();

		// Reverse cook wallet safely
		const cook = await User.findById(order.cookId);
		const refundAmount = order.totalAmount - order.totalAmount * 0.1; // subtract commission

		cook.walletBalance = Math.max(cook.walletBalance - refundAmount, 0);
		await cook.save();

		await WalletTransaction.create({
			cookId: cook._id,
			type: "debit",
			amount: refundAmount,
			reference: order._id.toString(),
			description: "Refund reversal",
		});

		// Notify user
		const io = getIO();
		io.to(`user_${order.userId}`).emit("order_update", order);
	}

	res.sendStatus(200);
};

export const paymentWebhook = async (req, res) => {
	const { orderId, amount } = req.body;

	const order = await Order.findById(orderId).populate("cook");

	if (!order) return res.sendStatus(404);

	if (order.paymentStatus === "paid") return res.sendStatus(200);

	order.paymentStatus = "paid";
	await order.save();

	// Commission example 10%

	const commission = amount * 0.1;

	const cookAmount = amount - commission;

	// Credit cook wallet

	await Wallet.findOneAndUpdate(
		{ user: order.cook._id },
		{
			$inc: {
				balance: cookAmount,
			},
		},
		{ upsert: true },
	);

	res.sendStatus(200);
};
