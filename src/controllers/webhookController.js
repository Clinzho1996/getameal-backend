import crypto from "crypto";
import { getIO } from "../config/socket.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const paystackWebhook = async (req, res) => {
	const hash = crypto
		.createHmac("sha512", process.env.PAYSTACK_SECRET)
		.update(JSON.stringify(req.body))
		.digest("hex");

	if (hash !== req.headers["x-paystack-signature"]) return res.sendStatus(401);

	const event = req.body;

	if (event.event === "charge.success") {
		const order = await Order.findById(event.data.reference);

		order.paymentStatus = "paid";
		order.status = "confirmed";
		await order.save();

		const cook = await User.findById(order.cookId);
		cook.walletBalance += order.totalAmount;
		await cook.save();

		await WalletTransaction.create({
			cookId: cook._id,
			type: "credit",
			amount: order.totalAmount,
			reference: order._id,
		});

		const io = getIO();
		io.to(`user_${order.userId}`).emit("order_update", order);
	}

	if (event.event === "refund.processed") {
		const order = await Order.findOne({
			paymentReference: event.data.transaction_reference,
		});

		order.paymentStatus = "refunded";
		await order.save();

		const cook = await User.findById(order.cookId);
		cook.walletBalance -= order.totalAmount;
		await cook.save();

		await WalletTransaction.create({
			cookId: cook._id,
			type: "debit",
			amount: order.totalAmount,
		});
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
