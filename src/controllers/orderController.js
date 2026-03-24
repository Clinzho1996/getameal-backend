import axios from "axios";
import mongoose from "mongoose";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { emitOrderUpdate, sendNotification } from "../utils/Notification.js";

// Create a new order (transaction safe)
import crypto from "crypto";

export const createOrder = async (req, res) => {
	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const { mealId, quantity, deliveryType, paymentType, note } = req.body;

		const meal = await Meal.findById(mealId).session(session);

		if (!meal || meal.portionsRemaining < quantity)
			throw new Error("Not enough portions available");

		meal.portionsRemaining -= quantity;
		await meal.save({ session });

		const total = meal.price * quantity;

		let paymentLinkCode = null;

		// generate friend payment code
		if (paymentType === "friend") {
			paymentLinkCode =
				"GATH-" + crypto.randomBytes(3).toString("hex").toUpperCase();
		}

		const order = await Order.create(
			[
				{
					userId: req.user._id,
					cookId: meal.cookId,
					mealItems: [{ mealId, quantity, price: meal.price }],
					totalAmount: total,
					deliveryType,
					note,
					paymentType,
					paymentReference: new mongoose.Types.ObjectId().toString(),
					paymentLinkCode,
				},
			],
			{ session },
		);

		const createdOrder = order[0];

		// If user pays immediately
		if (paymentType === "self") {
			const paystack = await axios.post(
				"https://api.paystack.co/transaction/initialize",
				{
					email: req.user.email,
					amount: total * 100,
					reference: createdOrder.paymentReference,
					callback_url: "getameal://payment-success",
					metadata: {
						orderId: createdOrder._id,
					},
				},
				{
					headers: {
						Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
					},
				},
			);

			await session.commitTransaction();
			session.endSession();

			return res.json({
				order: createdOrder,
				paymentUrl: paystack.data.data.authorization_url,
			});
		}

		// If friend pays
		if (paymentType === "friend") {
			await session.commitTransaction();
			session.endSession();

			return res.json({
				order: createdOrder,
				paymentLink: `${process.env.API_URL}/pay/${paymentLinkCode}`,
			});
		}
	} catch (error) {
		await session.abortTransaction();
		session.endSession();

		res.status(400).json({ message: error.message });
	}
};

// Update order (Owner or Cook)
export const updateOrder = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id).populate("userId");

		if (!order) return res.status(404).json({ message: "Order not found" });

		// Only owner or cook can update
		const isOwner = order.userId._id.toString() === req.user._id.toString();
		const isCook = order.cookId.toString() === req.user._id.toString();
		if (!isOwner && !isCook) {
			return res.status(403).json({ message: "Not authorized" });
		}

		const { status, ...otherUpdates } = req.body;

		// Allow cooks to update status
		if (isCook && status) {
			// Only allow certain transitions
			const allowedStatuses = [
				"confirmed",
				"cooking",
				"ready",
				"out_for_delivery",
				"delivered",
				"picked_up",
				"cancelled",
			];
			if (!allowedStatuses.includes(status)) {
				return res.status(400).json({ message: "Invalid status update" });
			}

			order.status = status;

			// If cook sets status to out_for_delivery, send OTP
			if (status === "out_for_delivery") {
				const otp = Math.floor(1000 + Math.random() * 9000).toString();
				order.otpCode = otp;
				order.otpExpires = Date.now() + 10 * 60 * 1000; // 10 mins

				await sendOTPEmail(order.userId.email, otp);
			}
		}

		// Apply other updates for owner or cook
		Object.assign(order, otherUpdates);

		await order.save();

		res.json({ message: "Order updated successfully", order });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Cancel order with automatic Paystack refund
export const cancelOrder = async (orderId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.paymentStatus !== "paid") {
		throw new Error("Cannot refund unpaid order");
	}

	// Refund via Paystack
	await axios.post(
		"https://api.paystack.co/refund",
		{ transaction: order.paymentReference },
		{
			headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` },
		},
	);

	order.status = "cancelled";
	await order.save();
};

// Get orders for logged-in user
export const getMyOrders = async (req, res) => {
	const orders = await Order.find({ userId: req.user._id })
		.populate("mealItems.mealId")
		.populate("cookId");
	res.json(orders);
};

// Get single order by ID
export const getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate("mealItems.mealId")
			.populate("cookId")
			.populate("userId");

		if (!order) {
			return res.status(404).json({
				message: "Order not found",
			});
		}

		// Only owner or cook can view
		if (
			order.userId._id.toString() !== req.user._id.toString() &&
			order.cookId._id.toString() !== req.user._id.toString()
		) {
			return res.status(403).json({
				message: "Not authorized",
			});
		}

		res.json(order);
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

// Update payment status
export const updatePaymentStatus = async (req, res) => {
	const order = await Order.findById(req.params.id);
	if (!order) return res.status(404).json({ message: "Order not found" });

	order.paymentStatus = "paid";
	order.status = "confirmed";
	await order.save();

	emitOrderUpdate(order);
	sendNotification(order.userId, "Payment successful, order confirmed");

	res.json(order);
};

// Send OTP when order is out for delivery

export const sendDeliveryOTP = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id).populate("userId");

		if (!order)
			return res.status(404).json({
				message: "Order not found",
			});

		if (order.status !== "out_for_delivery")
			return res.status(400).json({
				message: "Order must be out for delivery",
			});

		// Generate OTP
		const otp = Math.floor(1000 + Math.random() * 9000).toString();

		order.otpCode = otp;
		order.otpExpires = Date.now() + 10 * 60 * 1000; // 10 mins

		await order.save();

		await sendOTPEmail(order.userId.email, otp);

		res.json({
			message: "Delivery OTP sent",
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export const verifyDeliveryOTP = async (req, res) => {
	try {
		const { otp } = req.body;
		const order = await Order.findById(req.params.id);

		if (!order) return res.status(404).json({ message: "Order not found" });
		if (!order.otpCode)
			return res.status(400).json({ message: "No OTP requested" });
		if (order.otpExpires < Date.now())
			return res.status(400).json({ message: "OTP expired" });
		if (order.otpCode !== otp)
			return res.status(400).json({ message: "Invalid OTP" });

		// Mark order as completed
		if (order.deliveryType === "delivery") {
			order.status = "delivered";
		} else if (order.deliveryType === "pickup") {
			order.status = "picked_up";
		}

		order.otpCode = null;
		order.otpExpires = null;
		await order.save();

		// ---- CREDIT COOK WALLET AND DEDUCT COMMISSION ----
		const cook = await User.findById(order.cookId);

		const commissionRate = 0.1; // 10% commission
		const commission = order.totalAmount * commissionRate;
		const cookAmount = order.totalAmount - commission;

		cook.walletBalance += cookAmount;
		await cook.save();

		// Log transaction
		await WalletTransaction.create({
			cookId: cook._id,
			type: "credit",
			amount: cookAmount,
			reference: order._id.toString(),
		});

		res.json({
			message: "Order completed successfully",
			order,
			cookWalletBalance: cook.walletBalance,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getNewOrders = async (req, res) => {
	try {
		const orders = await Order.find({
			cookId: req.user.id,
			status: "pending",
		})
			.populate("userId", "fullName profileImage")
			.populate("mealItems.mealId", "name image price")
			.sort({ createdAt: -1 });

		res.json(orders);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getActiveOrders = async (req, res) => {
	try {
		const orders = await Order.find({
			cookId: req.user.id,
			status: {
				$in: ["confirmed", "cooking", "ready", "out_for_delivery"],
			},
		})
			.populate("userId", "fullName profileImage")
			.populate("mealItems.mealId", "name image price")
			.sort({ createdAt: -1 });

		res.json(orders);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getCompletedOrders = async (req, res) => {
	try {
		const orders = await Order.find({
			cookId: req.user.id,
			status: { $in: ["delivered", "picked_up"] },
		})
			.populate("userId", "fullName profileImage")
			.sort({ createdAt: -1 });

		res.json(orders);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getPastOrders = async (req, res) => {
	try {
		const orders = await Order.find({
			cookId: req.user.id,
			status: {
				$in: ["delivered", "picked_up", "cancelled"],
			},
		}).sort({ createdAt: -1 });

		res.json(orders);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getCookOrderStats = async (req, res) => {
	try {
		const cookId = new mongoose.Types.ObjectId(req.user.id);

		const stats = await Order.aggregate([
			{ $match: { cookId } },
			{
				$group: {
					_id: "$status",
					count: { $sum: 1 },
				},
			},
		]);

		const formatted = {
			pending: 0,
			active: 0,
			completed: 0,
			cancelled: 0,
		};

		stats.forEach((s) => {
			if (s._id === "pending") formatted.pending += s.count;

			if (
				["confirmed", "cooking", "ready", "out_for_delivery"].includes(s._id)
			) {
				formatted.active += s.count;
			}

			if (["delivered", "picked_up"].includes(s._id)) {
				formatted.completed += s.count;
			}

			if (s._id === "cancelled") {
				formatted.cancelled += s.count;
			}
		});

		res.json(formatted);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
