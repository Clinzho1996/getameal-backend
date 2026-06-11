import axios from "axios";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
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
		const {
			items,
			deliveryType,
			paymentType,
			note,
			deliveryAddress,
			deliveryRegion,
			selectedRegion,
		} = req.body;

		if (!items || !Array.isArray(items) || items.length === 0)
			throw new Error("No items provided");

		let totalAmount = 0;
		let totalDeliveryFee = 0;
		let mealItems = [];
		let cookId = null;

		// Accept both deliveryRegion and selectedRegion for flexibility
		const region = deliveryRegion || selectedRegion;

		// If delivery type is delivery, we need the selected region
		if (deliveryType === "delivery" && !region) {
			throw new Error("Delivery region is required for delivery orders");
		}

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

			// Calculate meal subtotal
			const mealSubtotal = meal.price * quantity;
			totalAmount += mealSubtotal;

			// Calculate delivery fee for this meal (if delivery)
			if (
				deliveryType === "delivery" &&
				meal.deliveryRegions &&
				meal.deliveryRegions.length > 0
			) {
				const regionFee = meal.deliveryRegions.find((r) => r.region === region);

				if (!regionFee) {
					throw new Error(
						`Delivery not available for region: ${region}. Available regions: ${meal.deliveryRegions.map((r) => r.region).join(", ")}`,
					);
				}

				// For multiple meals from same cook, use the highest delivery fee
				if (regionFee.fee > totalDeliveryFee) {
					totalDeliveryFee = regionFee.fee;
				}
			}

			mealItems.push({
				mealId,
				quantity,
				price: meal.price,
			});
		}

		// Add delivery fee to total amount if delivery
		const mealSubtotal = totalAmount;
		if (deliveryType === "delivery") {
			totalAmount += totalDeliveryFee;
		}

		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		const orderData = {
			userId: req.user._id,
			cookId,
			mealItems,
			totalAmount,
			deliveryType,
			note: note || "",
			paymentType,
			paymentReference,
			paymentStatus: "pending",
			status: "pending",
			deliveryFee: totalDeliveryFee,
		};

		// Add delivery address if provided
		if (deliveryType === "delivery") {
			if (deliveryAddress) {
				orderData.deliveryAddress = deliveryAddress;
			}
			// Store the selected region for reference
			orderData.selectedRegion = region;
		}

		const order = await Order.create([orderData], { session });

		const createdOrder = order[0];

		await session.commitTransaction();
		session.endSession();

		// Prepare response order object with all important fields
		const responseOrder = {
			_id: createdOrder._id,
			userId: createdOrder.userId,
			cookId: createdOrder.cookId,
			totalAmount: createdOrder.totalAmount,
			deliveryFee: createdOrder.deliveryFee,
			mealSubtotal: mealSubtotal,
			deliveryType: createdOrder.deliveryType,
			status: createdOrder.status,
			paymentStatus: createdOrder.paymentStatus,
			paymentReference: createdOrder.paymentReference, // ✅ Include payment reference
			note: createdOrder.note,
			createdAt: createdOrder.createdAt,
		};

		// Add region to response if delivery
		if (deliveryType === "delivery") {
			responseOrder.selectedRegion = region;
		}

		// Handle Paystack (Self payment)
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
				success: true,
				order: responseOrder,
				paymentUrl: paystack.data.data.authorization_url,
				paymentReference: paymentReference, // ✅ Also include at root level
				message: "Complete payment to confirm your order",
			});
		}

		// Friend payment
		if (paymentType === "friend") {
			const paymentLinkCode =
				"GATH-" + crypto.randomBytes(3).toString("hex").toUpperCase();

			createdOrder.paymentLinkCode = paymentLinkCode;
			await createdOrder.save();

			const paystackRes = await axios.post(
				"https://api.paystack.co/transaction/initialize",
				{
					email: req.user.email,
					amount: createdOrder.totalAmount * 100,
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
				success: true,
				order: responseOrder,
				paymentLinkCode,
				deepLink: `getameal://payment-friend/pay/${paymentLinkCode}`,
				paystackUrl: paystackRes.data.data.authorization_url,
				paymentReference: paymentReference, // ✅ Include payment reference
				message: "Share payment link with friend to complete payment",
			});
		}

		res.json({
			success: true,
			order: responseOrder,
			paymentReference: paymentReference, // ✅ Include payment reference for non-payment orders
			message: "Order created successfully",
		});
	} catch (error) {
		await session.abortTransaction();
		session.endSession();
		console.error("Create order error:", error);
		res.status(400).json({
			success: false,
			message: error.message,
		});
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
		let isNewlyProcessed = false;

		const metaOrderId = paymentData.metadata?.orderId;

		if (metaOrderId) {
			order = await Order.findById(metaOrderId)
				.populate("mealItems.mealId")
				.populate("cookId")
				.populate("userId");
		}

		if (!order && orderId) {
			order = await Order.findById(orderId)
				.populate("mealItems.mealId")
				.populate("cookId")
				.populate("userId");
		}

		if (!order) {
			console.error("❌ Order lookup failed", {
				reference,
				orderId,
				metadata: paymentData.metadata,
			});
			return res.status(404).json({ message: "Order not found" });
		}

		// ✅ Check if order is already paid but missing OTP
		let needsOtpRegeneration = false;

		if (order.paymentStatus === "paid" && !order.deliveryOtp) {
			console.log(
				`⚠️ Order ${order._id} is paid but missing OTP. Regenerating...`,
			);
			needsOtpRegeneration = true;
		}

		// ✅ Prevent double processing (but allow OTP regeneration)
		if (order.paymentStatus === "paid" && !needsOtpRegeneration) {
			console.log(`⏭️ Order ${order._id} already processed`);

			// Still return the order with OTP if it exists
			const orderResponse = order.toObject();
			return res.status(200).json({
				message: "Already processed",
				order: orderResponse,
				deliveryOtp: order.deliveryOtp,
			});
		}

		// Generate OTP if needed (new order or missing OTP)
		let deliveryOtp = order.deliveryOtp;

		if (needsOtpRegeneration || !order.deliveryOtp) {
			deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();
			console.log(`🔐 Generating OTP ${deliveryOtp} for order ${order._id}`);
			order.deliveryOtp = deliveryOtp;
			order.otpGeneratedAt = new Date();
		}

		// Update order if it's not already paid
		if (order.paymentStatus !== "paid") {
			// ✅ Validate amount
			const paidAmount = paymentData.amount / 100;

			if (paidAmount !== order.totalAmount) {
				console.warn("⚠️ Amount mismatch", {
					paidAmount,
					expected: order.totalAmount,
				});
				return res.status(400).json({
					message: "Amount mismatch",
				});
			}

			order.paymentStatus = "paid";
			order.status = "confirmed";
			order.paymentReference = reference;
			isNewlyProcessed = true;
		}

		await order.save();

		console.log(`✅ Order ${order._id} saved with OTP: ${order.deliveryOtp}`);

		// Only send notifications for newly processed orders
		if (isNewlyProcessed || needsOtpRegeneration) {
			// 📧 Send OTP to user via email
			if (order.userId && order.userId.email) {
				const emailHtml = `
					<h2>Order Confirmed! 🎉</h2>
					<p>Your order #${order._id.toString().slice(-6)} has been confirmed.</p>
					<p><strong>Your Delivery OTP is: ${deliveryOtp}</strong></p>
					<p>⚠️ Keep this OTP safe. You'll need to share it with the cook/delivery person when you receive your order.</p>
					<p>This OTP does not expire and is valid until your order is delivered.</p>
					<small>Order ID: ${order._id}</small>
				`;

				await sendOTPEmail(order.userId.email, deliveryOtp, emailHtml);
				console.log(`✅ OTP email sent to ${order.userId.email}`);
			}

			// 📱 Send push notification to user
			await sendPushToUser(
				order.userId._id,
				"🎫 Your Delivery OTP",
				`Your delivery OTP for order #${order._id.toString().slice(-6)} is: ${deliveryOtp}. Keep it safe!`,
				{
					type: "delivery_otp_generated",
					orderId: order._id.toString(),
					otp: deliveryOtp,
				},
			);

			// Send notification to COOK
			if (order.cookId) {
				await sendPushToUser(
					order.cookId._id,
					"🆕 New Paid Order! 💰",
					`${order.userId?.fullName || "Customer"} placed an order for ₦${order.totalAmount.toFixed(2)}. Customer OTP: ${deliveryOtp}`,
					{
						type: "new_paid_order",
						orderId: order._id.toString(),
						amount: order.totalAmount.toString(),
						otp: deliveryOtp,
					},
				);
			}
		}

		// Fetch updated order
		const updatedOrder = await Order.findById(order._id)
			.populate("userId")
			.populate("cookId")
			.populate("mealItems.mealId");

		return res.status(200).json({
			message: isNewlyProcessed
				? "Payment verified successfully"
				: "Order already processed - OTP regenerated",
			order: updatedOrder,
			deliveryOtp: deliveryOtp,
			otpGeneratedAt: order.otpGeneratedAt,
			note: `Your delivery OTP is: ${deliveryOtp}. It never expires - keep it safe until you receive your order!`,
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
		const order = await Order.findById(req.params.id)
			.populate("userId", "fullName email phone")
			.populate("cookId", "fullName email phone");

		if (!order) return res.status(404).json({ message: "Order not found" });

		// Only owner or cook can update
		const isOwner = order.userId._id.toString() === req.user._id.toString();
		const isCook = order.cookId._id.toString() === req.user._id.toString();

		if (!isOwner && !isCook) {
			return res.status(403).json({ message: "Not authorized" });
		}

		const { status, ...otherUpdates } = req.body;

		// Allow cooks to update status
		if (isCook && status) {
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

			// ✅ Check if status transition is valid based on current status
			const validTransitions = {
				pending: ["confirmed", "cancelled"],
				confirmed: ["cooking", "cancelled"],
				cooking: ["ready", "cancelled"],
				ready: ["out_for_delivery", "picked_up", "cancelled"],
				out_for_delivery: ["delivered", "cancelled"],
				delivered: [],
				picked_up: [],
				cancelled: [],
			};

			const allowedNextStatuses = validTransitions[order.status] || [];
			if (!allowedNextStatuses.includes(status) && order.status !== status) {
				return res.status(400).json({
					message: `Cannot transition from ${order.status} to ${status}. Allowed: ${allowedNextStatuses.join(", ")}`,
				});
			}

			const oldStatus = order.status;

			// Don't update if status is the same
			if (oldStatus === status) {
				return res.status(400).json({ message: `Order is already ${status}` });
			}

			order.status = status;

			// ✅ Send push notification to user when status changes
			if (order.userId && oldStatus !== status) {
				let statusMessage = "";
				let notificationTitle = "";

				switch (status) {
					case "confirmed":
						notificationTitle = "✅ Order Confirmed";
						statusMessage =
							"Your order has been confirmed! The cook will start preparing your meal soon. 🎉";
						break;
					case "cooking":
						notificationTitle = "👨‍🍳 Order Being Cooked";
						statusMessage =
							"Great news! The cook has started preparing your meal. It will be ready soon!";
						break;
					case "ready":
						notificationTitle = "✅ Order Ready";
						statusMessage =
							"Your order is ready for pickup/delivery! Please arrange for pickup or delivery. ✅";
						break;
					case "out_for_delivery":
						notificationTitle = "🚚 Order Out for Delivery";
						statusMessage =
							"Your order is out for delivery! It should arrive shortly. 🚚";
						break;
					case "delivered":
						notificationTitle = "🍽️ Order Delivered";
						statusMessage =
							"Your order has been delivered! Enjoy your meal! 🍽️";
						break;
					case "picked_up":
						notificationTitle = "📦 Order Picked Up";
						statusMessage =
							"You have picked up your order! Enjoy your meal! 🍽️";
						break;
					case "cancelled":
						notificationTitle = "❌ Order Cancelled";
						statusMessage =
							"Your order has been cancelled. If this was a mistake, please contact support. ❌";
						break;
					default:
						notificationTitle = "📦 Order Update";
						statusMessage = `Your order status has been updated to: ${status}`;
				}

				await sendPushToUser(
					order.userId._id,
					notificationTitle,
					statusMessage,
					{
						type: "order_status_update",
						orderId: order._id.toString(),
						status: status,
						oldStatus: oldStatus,
					},
				);

				console.log(
					`✅ Push notification sent to user ${order.userId._id} for order status: ${status}`,
				);
			}

			// If cook sets status to out_for_delivery, generate OTP for delivery verification
			if (status === "out_for_delivery" && !order.otpCode) {
				const otp = Math.floor(1000 + Math.random() * 9000).toString();
				order.otpCode = otp;
				order.otpExpires = Date.now() + 10 * 60 * 1000; // 10 mins

				// Send OTP via email
				await sendOTPEmail(order.userId.email, otp);

				// Send push notification about OTP
				await sendPushToUser(
					order.userId._id,
					"Delivery OTP Generated 📱",
					`Your delivery OTP is: ${otp}. Share this with your delivery person to verify delivery.`,
					{
						type: "delivery_otp",
						orderId: order._id.toString(),
						otp: otp,
					},
				);

				console.log(`✅ OTP ${otp} generated for order ${order._id}`);
			}

			// If order is delivered or picked up, mark as complete
			if (status === "delivered" || status === "picked_up") {
				order.paymentStatus = "paid";
				// You could also release payment to cook here
			}
		}

		// Allow customers to update certain fields (like cancellation note)
		if (isOwner && otherUpdates.note) {
			order.note = otherUpdates.note;
		}

		// Create admin notification for audit trail
		await createAdminNotification({
			title: "Order Status Updated",
			body: `Order #${order._id.toString().slice(-6)} status was updated from ${oldStatus || order.status} to ${order.status} by ${req.user.fullName}`,
			type: "order",
			data: {
				orderId: order._id,
				userId: order.userId._id,
				cookId: order.cookId._id,
				oldStatus: oldStatus,
				newStatus: order.status,
			},
		});

		// Apply other updates for owner or cook
		Object.assign(order, otherUpdates);
		await order.save();

		// Populate additional data for response
		const updatedOrder = await Order.findById(order._id)
			.populate("userId", "fullName email phone")
			.populate("cookId", "fullName email phone")
			.populate("mealItems.mealId", "name price images");

		res.json({
			success: true,
			message: "Order updated successfully",
			order: updatedOrder,
			statusTransition: {
				from: oldStatus || order.status,
				to: order.status,
			},
		});
	} catch (error) {
		console.error("Error in updateOrder:", error);
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

	// Send notification to user
	await sendNotification(
		order.userId,
		"Order cancelled",
		"Your order has been cancelled",
	);
	await sendPushToUser(
		order.userId,
		"Order cancelled",
		"Your order has been cancelled",
	);

	order.status = "cancelled";
	await order.save();
};

// Get orders for logged-in user
export const getMyOrders = async (req, res) => {
	const userId = req.user._id || req.user.id;

	const orders = await Order.find({ userId })
		.populate({
			path: "mealItems.mealId",
			populate: {
				path: "cookId",
				select: "fullName profileImage",
			},
		})
		.populate("cookId", "fullName email phone profileImage")
		.sort({ createdAt: -1 });

	// ✅ Add cook profile with kitchen address to each order
	const ordersWithDetails = await Promise.all(
		orders.map(async (order) => {
			const orderObj = order.toObject();

			// 🆕 Include OTP for paid orders that aren't completed yet
			if (order.paymentStatus === "paid" && order.deliveryOtp) {
				orderObj.deliveryOtp = order.deliveryOtp;
				orderObj.otpGeneratedAt = order.otpGeneratedAt;

				if (order.status !== "delivered" && order.status !== "picked_up") {
					orderObj.otpInstructions =
						order.deliveryType === "pickup"
							? "Show this OTP to the cook when picking up your order"
							: "Share this OTP with your delivery person when they deliver your order";
					orderObj.otpStatus = "active";
				} else {
					orderObj.otpStatus = "used";
				}
			}

			// Get cook profile
			const cookProfile = await CookProfile.findOne({
				userId: order.cookId._id,
			}).select(
				"cookAddress location cookDisplayName profilePhoto phone email",
			);

			orderObj.cookProfile = cookProfile || null;

			// Add kitchen address to each meal item
			if (orderObj.mealItems && orderObj.mealItems.length > 0) {
				for (const item of orderObj.mealItems) {
					if (item.mealId && item.mealId.cookId) {
						item.kitchenAddress = cookProfile?.cookAddress || null;
						item.kitchenLocation = cookProfile?.location || null;
					}
				}
			}

			return orderObj;
		}),
	);

	res.json(ordersWithDetails);
};

// Get single order by ID
export const getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate({
				path: "mealItems.mealId",
				populate: {
					path: "cookId",
					select: "fullName profileImage",
				},
			})
			.populate("cookId", "fullName email phone profileImage")
			.populate("userId", "fullName email phone profileImage");

		if (!order) {
			return res.status(404).json({
				message: "Order not found",
			});
		}

		// Only owner or cook can view
		const isOwner = order.userId._id.toString() === req.user._id.toString();
		const isCook = order.cookId._id.toString() === req.user._id.toString();

		if (!isOwner && !isCook) {
			return res.status(403).json({
				message: "Not authorized",
			});
		}

		// ✅ Add cook profile with kitchen address
		const orderObj = order.toObject();

		// 🆕 Include OTP for the order owner
		if (isOwner) {
			if (order.paymentStatus === "paid" && order.deliveryOtp) {
				orderObj.deliveryOtp = order.deliveryOtp;
				orderObj.otpGeneratedAt = order.otpGeneratedAt;
				orderObj.otpInstructions =
					order.deliveryType === "pickup"
						? "⚠️ Show this OTP to the cook when picking up your order"
						: "⚠️ Share this OTP with your delivery person when they deliver your order";

				// Check if order is already completed
				if (order.status === "delivered" || order.status === "picked_up") {
					orderObj.otpStatus = "used";
					orderObj.otpMessage =
						"This OTP has already been used to complete the order";
				} else {
					orderObj.otpStatus = "active";
					orderObj.otpMessage =
						"Keep this OTP safe. Share it only at the time of delivery/pickup";
				}
			} else if (order.paymentStatus !== "paid") {
				orderObj.otpStatus = "pending_payment";
				orderObj.otpMessage =
					"OTP will be generated after payment is confirmed";
			}
		}

		// For cooks, show OTP info but not the code
		if (isCook && order.deliveryOtp && order.paymentStatus === "paid") {
			orderObj.hasOtp = true;
			orderObj.otpStatus =
				order.status === "delivered" || order.status === "picked_up"
					? "used"
					: "active";
			orderObj.otpMessage = isCook
				? "Ask the customer for their OTP to verify delivery"
				: null;
		}

		const cookProfile = await CookProfile.findOne({
			userId: order.cookId._id,
		}).select(
			"cookAddress location cookDisplayName profilePhoto phone email isApproved rating",
		);

		orderObj.cookProfile = cookProfile || null;

		// Add kitchen address to each meal item
		if (orderObj.mealItems && orderObj.mealItems.length > 0) {
			for (const item of orderObj.mealItems) {
				if (item.mealId && item.mealId.cookId) {
					item.kitchenAddress = cookProfile?.cookAddress || null;
					item.kitchenLocation = cookProfile?.location || null;
					item.cookDisplayName = cookProfile?.cookDisplayName || null;
				}
			}
		}

		res.json(orderObj);
	} catch (error) {
		console.error("Error in getOrderById:", error);
		res.status(500).json({
			message: error.message,
		});
	}
};

// Update payment status
export const updatePaymentStatus = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate("userId", "fullName email")
			.populate("cookId", "fullName email");

		if (!order) return res.status(404).json({ message: "Order not found" });

		order.paymentStatus = "paid";
		order.status = "confirmed";
		await order.save();

		// ✅ Send push notification to cook
		if (order.cookId) {
			await sendPushToUser(
				order.cookId._id,
				"Payment Confirmed! 💰",
				`Payment of ₦${order.totalAmount.toFixed(2)} has been confirmed for order #${order._id.toString().slice(-6)}`,
				{
					type: "payment_confirmed",
					orderId: order._id.toString(),
					amount: order.totalAmount.toString(),
				},
			);
		}

		// ✅ Send push notification to user
		if (order.userId) {
			await sendPushToUser(
				order.userId._id,
				"Payment Successful! 🎉",
				`Your payment of ₦${order.totalAmount.toFixed(2)} has been confirmed. Your order is now confirmed!`,
				{
					type: "payment_success",
					orderId: order._id.toString(),
					amount: order.totalAmount.toString(),
				},
			);
		}

		// Emit socket update if available
		if (typeof emitOrderUpdate === "function") {
			emitOrderUpdate(order);
		}

		// Send admin notification
		await createAdminNotification({
			title: "Payment Confirmed",
			body: `Payment of ₦${order.totalAmount.toFixed(2)} confirmed for order ${order._id}`,
			type: "payment",
			data: { orderId: order._id },
		});

		res.json(order);
	} catch (error) {
		console.error("Error in updatePaymentStatus:", error);
		res.status(500).json({ message: error.message });
	}
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

// Get delivery OTP for user (only the customer)
export const getDeliveryOTP = async (req, res) => {
	try {
		const { orderId } = req.params;

		const order = await Order.findById(orderId);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		// Only the order owner can view their OTP
		const isOwner = order.userId.toString() === req.user._id.toString();
		const isAdmin = req.user.role === "admin";

		if (!isOwner && !isAdmin) {
			return res
				.status(403)
				.json({ message: "Not authorized to view this OTP" });
		}

		// Check if order is paid
		if (order.paymentStatus !== "paid") {
			return res.status(400).json({
				message:
					"Order payment not confirmed yet. OTP will be generated after payment.",
				paymentStatus: order.paymentStatus,
			});
		}

		// Check if order is already completed
		if (order.status === "delivered" || order.status === "picked_up") {
			return res.status(400).json({
				message: `Order already ${order.status}. OTP has been used.`,
				status: order.status,
			});
		}

		if (!order.deliveryOtp) {
			return res.status(404).json({
				message: "No delivery OTP found. Please contact support.",
			});
		}

		res.json({
			success: true,
			otp: order.deliveryOtp,
			generatedAt: order.otpGeneratedAt,
			deliveryType: order.deliveryType,
			message: `Your delivery OTP is valid until order is ${order.deliveryType === "pickup" ? "picked up" : "delivered"}`,
			instructions:
				order.deliveryType === "pickup"
					? "Show this OTP to the cook when picking up your order"
					: "Share this OTP with your delivery person when they deliver your order",
			orderStatus: order.status,
		});
	} catch (error) {
		console.error("Error getting delivery OTP:", error);
		res.status(500).json({ message: error.message });
	}
};

export const verifyDeliveryOTP = async (req, res) => {
	try {
		const { otp } = req.body;
		const order = await Order.findById(req.params.id)
			.populate("userId", "fullName email")
			.populate("cookId", "fullName email");

		if (!order) return res.status(404).json({ message: "Order not found" });

		// ✅ Check if user is authorized to verify OTP (cook or admin)
		const isCook = order.cookId._id.toString() === req.user._id.toString();
		const isAdmin = req.user.role === "admin";

		if (!isCook && !isAdmin) {
			return res.status(403).json({ message: "Not authorized to verify OTP" });
		}

		// ✅ Check if order has been paid for
		if (order.paymentStatus !== "paid") {
			return res.status(400).json({
				message:
					"Order payment not completed yet. OTP verification is only available after payment.",
				paymentStatus: order.paymentStatus,
			});
		}

		// ✅ Check if order is already completed
		if (order.status === "delivered" || order.status === "picked_up") {
			return res.status(400).json({
				message: `Order already ${order.status}. OTP has already been used.`,
				status: order.status,
			});
		}

		// ✅ Check if OTP exists
		if (!order.deliveryOtp) {
			return res.status(400).json({
				message: "No OTP generated for this order. Please contact support.",
				orderStatus: order.status,
			});
		}

		// ✅ Verify OTP
		if (order.deliveryOtp !== otp) {
			return res
				.status(400)
				.json({ message: "Invalid OTP. Please check and try again." });
		}

		// Store the used OTP for logging before clearing
		const usedOtp = order.deliveryOtp;
		const oldStatus = order.status;

		// Mark order as completed based on delivery type
		if (order.deliveryType === "delivery") {
			order.status = "delivered";
		} else if (order.deliveryType === "pickup") {
			order.status = "picked_up";
		}

		// Clear OTP after successful verification (one-time use)
		order.deliveryOtp = null;
		order.otpGeneratedAt = null;
		await order.save();

		console.log(
			`✅ Order ${order._id} status updated from ${oldStatus} to ${order.status}`,
		);

		// ---- CREDIT COOK WALLET AND DEDUCT COMMISSION ----
		const cook = await User.findById(order.cookId);
		if (!cook) {
			console.error(`❌ Cook not found for order ${order._id}`);
			return res.status(404).json({ message: "Cook not found" });
		}

		const commissionRate = 0.1; // 10% commission
		const commission = order.totalAmount * commissionRate;
		const cookAmount = order.totalAmount - commission;

		console.log(`💰 Processing payment for cook ${cook._id}`);
		console.log(`   Order Amount: ₦${order.totalAmount}`);
		console.log(`   Commission (10%): ₦${commission}`);
		console.log(`   Cook Earnings: ₦${cookAmount}`);
		console.log(`   Current Wallet Balance: ₦${cook.walletBalance || 0}`);

		// Update cook's wallet balance in User model
		const previousBalance = cook.walletBalance || 0;
		cook.walletBalance = previousBalance + cookAmount;
		await cook.save();

		console.log(
			`✅ Cook wallet updated: ₦${previousBalance} → ₦${cook.walletBalance}`,
		);

		// ✅ Create wallet transaction using your schema (with cookId)
		try {
			const transaction = await WalletTransaction.create({
				cookId: cook._id, // Using cookId as per your schema
				type: "credit",
				amount: cookAmount,
				reference: order._id.toString(),
				status: "success",
			});
			console.log(`✅ Wallet transaction created: ${transaction._id}`);
		} catch (txError) {
			console.error(`❌ Failed to create wallet transaction:`, txError.message);
			// Don't fail the whole operation if transaction logging fails
		}

		// Also update CookProfile wallet balance if it exists (for consistency)
		try {
			const cookProfile = await CookProfile.findOne({ userId: order.cookId });
			if (cookProfile) {
				const previousProfileBalance = cookProfile.walletBalance || 0;
				cookProfile.walletBalance = previousProfileBalance + cookAmount;
				await cookProfile.save();
				console.log(
					`✅ CookProfile wallet updated: ₦${previousProfileBalance} → ₦${cookProfile.walletBalance}`,
				);
			}
		} catch (profileError) {
			console.error(
				`❌ Failed to update CookProfile wallet:`,
				profileError.message,
			);
		}

		// ✅ Send push notification to cook
		await sendPushToUser(
			cook._id,
			"✅ Order Completed & Payment Received! 💰",
			`You earned ₦${cookAmount.toFixed(2)} from order #${order._id.toString().slice(-6)}. Commission: ₦${commission.toFixed(2)}. New balance: ₦${cook.walletBalance.toFixed(2)}`,
			{
				type: "order_completed",
				orderId: order._id.toString(),
				amount: cookAmount.toString(),
				commission: commission.toString(),
				newBalance: cook.walletBalance.toString(),
			},
		);

		// ✅ Send push notification to user
		if (order.userId) {
			await sendPushToUser(
				order.userId._id,
				"✅ Order Completed! 🎉",
				`Your order has been ${order.status === "delivered" ? "delivered" : "picked up"}. Thank you for choosing GetAMeal! Enjoy your meal! 🍽️`,
				{
					type: "order_completed",
					orderId: order._id.toString(),
					status: order.status,
				},
			);
		}

		// Send admin notification
		await createAdminNotification({
			title: "Order Completed",
			body: `Order #${order._id.toString().slice(-6)} completed. Cook earned ₦${cookAmount.toFixed(2)}. Commission: ₦${commission.toFixed(2)}. OTP ${usedOtp} used.`,
			type: "order",
			data: {
				orderId: order._id,
				cookAmount,
				commission,
				usedOtp,
				verifiedBy: req.user.fullName,
				verifiedAt: new Date().toISOString(),
			},
		});

		res.json({
			success: true,
			message: `Order ${order.status === "delivered" ? "delivered" : "picked up"} successfully!`,
			order: {
				_id: order._id,
				status: order.status,
				deliveryType: order.deliveryType,
				totalAmount: order.totalAmount,
			},
			cookWalletBalance: cook.walletBalance,
			earnings: {
				amount: cookAmount,
				commission: commission,
				previousBalance: previousBalance,
				newBalance: cook.walletBalance,
			},
			verificationDetails: {
				verifiedBy: req.user.fullName,
				verifiedAt: new Date().toISOString(),
				otpUsed: usedOtp,
			},
		});
	} catch (error) {
		console.error("Error in verifyDeliveryOTP:", error);
		res.status(500).json({
			success: false,
			message: error.message,
			stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
		});
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

export const sendOrderReminderToCook = async (req, res) => {
	try {
		const { orderId } = req.params;

		const order = await Order.findById(orderId)
			.populate("cookId", "fullName email")
			.populate("userId", "fullName");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		// Only send if order is pending or confirmed
		if (!["pending", "confirmed"].includes(order.status)) {
			return res.status(400).json({
				message: "Reminder can only be sent for pending or confirmed orders",
			});
		}

		await sendPushToUser(
			order.cookId._id,
			"⏰ Order Reminder",
			`You have a pending order from ${order.userId.fullName} for ₦${order.totalAmount.toFixed(2)}. Please confirm or start cooking.`,
			{
				type: "order_reminder",
				orderId: order._id.toString(),
			},
		);

		res.json({
			success: true,
			message: "Reminder sent to cook",
		});
	} catch (error) {
		console.error("Error sending reminder:", error);
		res.status(500).json({ message: error.message });
	}
};
