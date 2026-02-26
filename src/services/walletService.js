import Order from "../models/Order";

export const creditCookWallet = async (order) => {
	const cook = await User.findById(order.cookId);

	cook.walletBalance += order.totalAmount;
	await cook.save();

	await WalletTransaction.create({
		cookId: cook._id,
		type: "credit",
		amount: order.totalAmount,
		reference: order._id,
	});
};

export const handleRefund = async (data) => {
	const order = await Order.findOne({ refundReference: data.reference });

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
};
