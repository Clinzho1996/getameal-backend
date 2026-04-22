import axios from "axios";
import mongoose from "mongoose";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { emitOrderUpdate } from "../utils/Notification.js";

import crypto from "crypto";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";

export const createOrder = async (req, res) => {
	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const { items, deliveryType, paymentType, note } = req.body;

		if (!items || !Array.isArray(items) || items.length === 0)
			throw new Error("No items provided");

		let totalAmount = 0;
		let mealItems = [];
		let cookId = null;

		for (const item of items) {
			const { mealId, quantity } = item;
			if (!mealId || !quantity) throw new Error("Invalid item format");

			const meal = await Meal.findOneAndUpdate(
				{ _id: mealId, portionsRemaining: { $gte: quantity } },
				{ $inc: { portionsRemaining: -quantity } },
				{ new: true, session },
			);

			if (!meal) throw new Error(`Not enough portions for meal ${mealId}`);

			if (!cookId) cookId = meal.cookId;
			if (cookId.toString() !== meal.cookId.toString())
				throw new Error("All meals must be from the same cook");

			totalAmount += meal.price * quantity;

			mealItems.push({ mealId, quantity, price: meal.price });
		}

		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		const order = await Order.create(
			[
				{
					userId: req.user._id,
					cookId,
					mealItems,
					totalAmount,
					deliveryType,
					note,
					paymentType,
					paymentReference,
				},
			],
			{ session },
		);

		await createAdminNotification({
			title: "New Order",
			body: `A new order was placed by ${req.user.fullName}`,
			type: "order",
			data: { orderId: order._id },
		});

		const createdOrder = order[0];

		await session.commitTransaction();
		session.endSession();

		// Handle Paystack
		if (paymentType === "self") {
			const paystack = await axios.post(
				"https://api.paystack.co/transaction/initialize",
				{
					email: req.user.email,
					amount: totalAmount * 100,
					reference: paymentReference,
					callback_url: `${process.env.API_URL}/orders/payment/redirect?orderId=${createdOrder._id}&reference=${paymentReference}`,
					metadata: { orderId: createdOrder._id },
				},
				{
					headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}` },
				},
			);

			return res.json({
				order: createdOrder,
				paymentUrl: paystack.data.data.authorization_url,
			});
		}

		// Friend payment
		if (paymentType === "friend") {
			const paymentLinkCode =
				"GATH-" + crypto.randomBytes(3).toString("hex").toUpperCase();

			createdOrder.paymentLinkCode = paymentLinkCode;
			await createdOrder.save();

			// 🔐 Initialize Paystack transaction
			const paymentReference = `FRIEND-${Date.now()}`;

			const paystackRes = await axios.post(
				"https://api.paystack.co/transaction/initialize",
				{
					email: createdOrder.userEmail || "friend@getameal.com", // fallback
					amount: createdOrder.totalAmount * 100, // kobo
					reference: paymentReference,
					callback_url: `${process.env.API_URL}/orders/payment/redirect?orderId=${createdOrder._id}&reference=${paymentReference}`,
					metadata: {
						orderId: createdOrder._id,
						paymentType: "friend",
						paymentLinkCode,
					},
				},
				{
					headers: {
						Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			return res.json({
				order: createdOrder,
				paymentLinkCode,
				deepLink: `getameal://payment-friend/pay/${paymentLinkCode}`,
				paystackUrl: paystackRes.data.data.authorization_url,
				reference: paymentReference,
			});
		}

		res.json({ order: createdOrder });
	} catch (error) {
		await session.abortTransaction();
		session.endSession();
		res.status(400).json({ message: error.message });
	}
};

export const paymentRedirect = async (req, res) => {
	try {
		const { orderId, reference } = req.query;

		// Redirect to mobile deep link
		return res.redirect(
			`getameal://payment-success?orderId=${orderId}&reference=${reference}`,
		);
	} catch (error) {
		console.error("Redirect error:", error);
		res.status(500).send("Redirect failed");
	}
};

export const handlePaymentCallback = async (req, res) => {
	try {
		const { reference, orderId } = req.query;

		if (!reference) {
			return res.status(400).json({ message: "Missing payment reference" });
		}

		// 🔐 Verify payment with Paystack
		const verify = await axios.get(
			`https://api.paystack.co/transaction/verify/${reference}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		const paymentData = verify.data?.data;

		if (!paymentData) {
			return res.status(400).json({ message: "Invalid Paystack response" });
		}

		if (paymentData.status !== "success") {
			return res.status(400).json({ message: "Payment not successful" });
		}

		let order = null;

		// ✅ 1. Try metadata (BEST PRACTICE)
		const metaOrderId = paymentData.metadata?.orderId;

		if (metaOrderId) {
			order = await Order.findById(metaOrderId)
				.populate("mealItems.mealId")
				.populate("cookId")
				.populate("userId");
		}

		// ✅ 2. Fallback to query param
		if (!order && orderId) {
			order = await Order.findById(orderId)
				.populate("mealItems.mealId")
				.populate("cookId")
				.populate("userId");
		}

		// ❌ If still not found
		if (!order) {
			console.error("❌ Order lookup failed", {
				reference,
				orderId,
				metadata: paymentData.metadata,
			});
			return res.status(404).json({ message: "Order not found" });
		}

		// ✅ Prevent double processing (idempotency)
		if (order.paymentStatus === "paid") {
			return res.status(200).json({
				message: "Already processed",
				order,
			});
		}

		// ✅ Optional: Validate amount (important)
		const paidAmount = paymentData.amount / 100; // Paystack returns kobo

		if (paidAmount !== order.totalAmount) {
			console.warn("⚠️ Amount mismatch", {
				paidAmount,
				expected: order.totalAmount,
			});
			return res.status(400).json({
				message: "Amount mismatch",
			});
		}

		// ✅ Update order
		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = reference;

		await order.save();

		// ✅ Emit realtime update (if you use sockets)
		if (typeof emitOrderUpdate === "function") {
			emitOrderUpdate(order);
		}

		// ✅ Notify user
		if (typeof sendNotification === "function") {
			sendNotification(
				order.userId,
				"Payment successful",
				"Your order has been confirmed",
			);

			sendPushToUser(
				order.userId,
				"Payment successful",
				"Your order has been confirmed",
			);
		}

		// ✅ Admin notification (safe version)
		if (typeof createAdminNotification === "function") {
			await createAdminNotification({
				title: "Payment Received",
				body: `₦${order.totalAmount.toFixed(
					2,
				)} payment received for order ${order._id}`,
				type: "order",
				data: { orderId: order._id },
			});
		}

		return res.status(200).json({
			message: "Payment verified successfully",
			order,
		});
	} catch (error) {
		console.error(
			"❌ Payment verification error:",
			error?.response?.data || error.message,
		);

		return res.status(500).json({
			message: "Payment verification failed",
			error: error.message,
		});
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

		await createAdminNotification({
			title: "Order Update",
			body: `The order status was updated by ${req.user.fullName}`,
			type: "order",
			data: { orderId: order._id },
		});
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

	await createAdminNotification({
		title: "Order Cancelled",
		body: `The order was cancelled by ${order.userId.fullName}`,
		type: "order",
		data: { orderId: order._id },
	});

	order.status = "cancelled";
	await order.save();
};

// Get orders for logged-in user
export const getMyOrders = async (req, res) => {
	console.log("USER OBJECT:", req.user);

	const userId = req.user._id || req.user.id;

	console.log("RESOLVED USER ID:", userId);

	const orders = await Order.find({ userId })
		.populate("mealItems.mealId")
		.populate("cookId")
		.sort({ createdAt: -1 });

	console.log("FOUND ORDERS:", orders.length);

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
