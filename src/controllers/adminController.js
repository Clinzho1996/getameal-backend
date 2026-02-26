import CookProfile from "../models/CookProfile.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const getDashboardStats = async (req, res) => {
	const totalUsers = await User.countDocuments();
	const totalCooks = await CookProfile.countDocuments();
	const totalOrders = await Order.countDocuments();
	const totalRevenue = await Order.aggregate([
		{ $match: { paymentStatus: "paid" } },
		{ $group: { _id: null, total: { $sum: "$totalAmount" } } },
	]);

	res.json({
		totalUsers,
		totalCooks,
		totalOrders,
		totalRevenue: totalRevenue[0]?.total || 0,
	});
};

export const getPendingCooks = async (req, res) => {
	const cooks = await CookProfile.find({ isApproved: false }).populate(
		"userId",
	);
	res.json(cooks);
};

export const approveCook = async (req, res) => {
	const cook = await CookProfile.findById(req.params.id);
	cook.isApproved = true;
	await cook.save();

	res.json({ message: "Cook approved" });
};

export const suspendCook = async (req, res) => {
	const cook = await CookProfile.findById(req.params.id);
	cook.isAvailable = false;
	await cook.save();

	res.json({ message: "Cook suspended" });
};

export const forceRefund = async (req, res) => {
	const order = await Order.findById(req.params.id);

	order.status = "cancelled";
	order.paymentStatus = "refunded";
	await order.save();

	await WalletTransaction.create({
		cookId: order.cookId,
		type: "debit",
		amount: order.totalAmount,
	});

	res.json({ message: "Refund processed by admin" });
};
