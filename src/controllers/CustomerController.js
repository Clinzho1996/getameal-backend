import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { createAdminNotification } from "../utils/adminNotification.js";
import { getResendInstance } from "../utils/emailService.js";

// GET customers with filters and stats
export const getCustomers = async (req, res) => {
	try {
		const { status, city, dateFrom, dateTo, sortBy } = req.query;

		const filter = {};
		if (status) filter.status = status; // active/suspended
		if (city) filter["location.address"] = { $regex: city, $options: "i" };
		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo)
			filter.createdAt.$lte = new Date(
				new Date(dateTo).setHours(23, 59, 59, 999),
			);

		let query = User.find(filter);

		// Sorting
		if (sortBy === "newest") query = query.sort({ createdAt: -1 });
		if (sortBy === "oldest") query = query.sort({ createdAt: 1 });
		if (sortBy === "mostOrders") {
			const usersWithOrders = await Order.aggregate([
				{ $group: { _id: "$userId", orderCount: { $sum: 1 } } },
				{ $sort: { orderCount: -1 } },
			]);
			const ids = usersWithOrders.map((u) => u._id);
			query = User.find({ _id: { $in: ids } });
		}

		const users = await query;

		// Map with extra stats
		const data = await Promise.all(
			users.map(async (user) => {
				const orders = await Order.find({ userId: user._id });
				const lastOrder =
					orders.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
				return {
					_id: user._id,
					fullName: user.fullName,
					email: user.email,
					phone: user.phone,
					status: user.status || "active",
					city: user.location?.address || "",
					joinedAt: user.createdAt,
					lastActive: lastOrder ? lastOrder.updatedAt : null,
					ordersCount: orders.length,
					notes: Array.isArray(user.notes)
						? user.notes.map((n) => ({
								note: n.note,
								createdAt: n.createdAt,
							}))
						: [],
				};
			}),
		);

		// Stats
		const now = new Date();
		const today = now.setHours(0, 0, 0, 0);
		const last7Days = new Date();
		last7Days.setDate(now.getDate() - 7);
		const last30Days = new Date();
		last30Days.setDate(now.getDate() - 30);

		const stats = {
			totalCustomers: await User.countDocuments(),
			newToday: await User.countDocuments({ createdAt: { $gte: today } }),
			joinedLast7Days: await User.countDocuments({
				createdAt: { $gte: last7Days },
			}),
			joinedLast30Days: await User.countDocuments({
				createdAt: { $gte: last30Days },
			}),
			noPurchases: await User.countDocuments({
				_id: { $nin: await Order.distinct("userId") },
			}),
		};

		res.status(200).json({ stats, customers: data });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// GET single customer by ID
export const getCustomerById = async (req, res) => {
	try {
		const { userId } = req.params;

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// Fetch user's orders
		const orders = await Order.find({ userId: user._id });

		const lastOrder =
			orders.sort((a, b) => b.createdAt - a.createdAt)[0] || null;

		// Optional: wallet transactions (if you want history)
		const transactions = await WalletTransaction.find({
			userId: user._id,
		}).sort({ createdAt: -1 });

		const customer = {
			_id: user._id,
			fullName: user.fullName,
			email: user.email,
			phone: user.phone,
			status: user.status || "active",
			city: user.location?.address || "",
			joinedAt: user.createdAt,
			lastActive: lastOrder ? lastOrder.updatedAt : null,
			ordersCount: orders.length,
			walletBalance: user.walletBalance || 0,
			notes: user.notes || [],
			orders, // include if needed (can remove if too heavy)
			transactions, // include if needed
		};

		res.status(200).json({ customer });
	} catch (error) {
		console.error(error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// Add note to customer
export const addCustomerNote = async (req, res) => {
	try {
		const { userId } = req.params;
		const { note } = req.body;

		if (!note) {
			return res.status(400).json({ message: "Note is required" });
		}

		const user = await User.findByIdAndUpdate(
			userId,
			{
				$push: {
					notes: {
						note,
						createdAt: new Date(),
					},
				},
			},
			{ new: true },
		);

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		return res.status(200).json({
			message: "Note added",
			notes: user.notes,
		});
	} catch (error) {
		return res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// Message customer using Resend
export const messageCustomer = async (req, res) => {
	try {
		const { userId } = req.params;
		const { subject, message } = req.body;

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		const resend = getResendInstance();
		await resend.emails.send({
			from: process.env.EMAIL_FROM,
			to: user.email,
			subject,
			html: `<p>${message}</p>`,
		});

		res.status(200).json({ message: "Email sent successfully" });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Credit customer wallet
export const creditCustomerWallet = async (req, res) => {
	try {
		const { userId } = req.params;
		const { amount, reason, note } = req.body;

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		user.walletBalance = (user.walletBalance || 0) + amount;
		await user.save();

		await WalletTransaction.create({
			userId: user._id,
			type: "credit",
			amount,
			reason,
			note,
			reference: new mongoose.Types.ObjectId(),
		});

		res
			.status(200)
			.json({ message: "Wallet credited", balance: user.walletBalance });

		await createAdminNotification({
			title: "Wallet Credited",
			body: `The customer "${user.fullName}" has been credited with ${amount}`,
			type: "customer",
			data: { userId: req.user._id },
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Suspend / Reactivate customer
export const toggleCustomerStatus = async (req, res) => {
	try {
		const { userId } = req.params;
		const { action } = req.body; // suspend or activate

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		user.status = action === "suspend" ? "suspended" : "active";
		await user.save();

		res.status(200).json({ message: `User ${action}ed`, status: user.status });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
