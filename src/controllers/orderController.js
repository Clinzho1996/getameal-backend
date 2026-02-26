import axios from "axios";
import mongoose from "mongoose";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { emitOrderUpdate, sendNotification } from "../utils/Notification.js";

// Create a new order (transaction safe)
export const createOrder = async (req, res) => {
	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const { mealId, quantity, deliveryType } = req.body;

		const meal = await Meal.findById(mealId).session(session);
		if (!meal || meal.portionsRemaining < quantity)
			throw new Error("Not enough portions available");

		meal.portionsRemaining -= quantity;
		await meal.save();

		const total = meal.price * quantity;

		const order = await Order.create(
			[
				{
					userId: req.user._id,
					cookId: meal.cookId,
					mealItems: [{ mealId, quantity, price: meal.price }],
					totalAmount: total,
					deliveryType,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		session.endSession();

		res.json(order[0]);
	} catch (error) {
		await session.abortTransaction();
		session.endSession();
		res.status(400).json({ message: error.message });
	}
};

// Update order (Owner or Cook)
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

		if (!order)
			return res.status(404).json({
				message: "Order not found",
			});

		if (!order.otpCode)
			return res.status(400).json({
				message: "No OTP requested",
			});

		if (order.otpExpires < Date.now())
			return res.status(400).json({
				message: "OTP expired",
			});

		if (order.otpCode !== otp)
			return res.status(400).json({
				message: "Invalid OTP",
			});

		// Complete order

		if (order.deliveryType === "delivery") {
			order.status = "delivered";
		}

		if (order.deliveryType === "pickup") {
			order.status = "picked_up";
		}

		order.otpCode = null;
		order.otpExpires = null;

		await order.save();

		res.json({
			message: "Order completed successfully",
			order,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};
