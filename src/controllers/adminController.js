import axios from "axios";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import User from "../models/User.js";
import { getDateRanges } from "../utils/getDateRange.js";

export const getOverviewStats = async (req, res) => {
	try {
		const { start, end, zone } = req.query;

		const { currentStart, currentEnd, prevStart, prevEnd } = getDateRanges(
			start,
			end,
		);

		// FILTERS
		const baseMatch = {
			createdAt: { $gte: currentStart, $lte: currentEnd },
		};

		const prevMatch = {
			createdAt: { $gte: prevStart, $lte: prevEnd },
		};

		if (zone) {
			baseMatch["deliveryAddress.region"] = zone;
			prevMatch["deliveryAddress.region"] = zone;
		}

		// =========================
		// CURRENT METRICS
		// =========================
		const [
			totalOrders,
			completedOrders,
			cancelledOrders,
			refundedOrders,
			gmvData,
		] = await Promise.all([
			Order.countDocuments(baseMatch),

			Order.countDocuments({
				...baseMatch,
				status: { $in: ["delivered", "picked_up"] },
			}),

			Order.countDocuments({
				...baseMatch,
				status: "cancelled",
			}),

			Order.countDocuments({
				...baseMatch,
				paymentStatus: "refunded",
			}),

			Order.aggregate([
				{ $match: baseMatch },
				{
					$group: {
						_id: null,
						total: { $sum: "$totalAmount" },
					},
				},
			]),
		]);

		const gmv = gmvData[0]?.total || 0;

		// =========================
		// PREVIOUS METRICS
		// =========================
		const [prevTotalOrders, prevCancelled, prevRefunded, prevGmvData] =
			await Promise.all([
				Order.countDocuments(prevMatch),

				Order.countDocuments({
					...prevMatch,
					status: "cancelled",
				}),

				Order.countDocuments({
					...prevMatch,
					paymentStatus: "refunded",
				}),

				Order.aggregate([
					{ $match: prevMatch },
					{
						$group: {
							_id: null,
							total: { $sum: "$totalAmount" },
						},
					},
				]),
			]);

		const prevGmv = prevGmvData[0]?.total || 0;

		// =========================
		// ACTIVE COOKS
		// =========================
		const activeCooks = await Order.distinct("cookId", baseMatch);
		const prevActiveCooks = await Order.distinct("cookId", prevMatch);

		// =========================
		// % CHANGE FUNCTION
		// =========================
		const calcChange = (current, prev) => {
			if (prev === 0) return current === 0 ? 0 : 100;
			return ((current - prev) / prev) * 100;
		};

		res.json({
			activeCooks: {
				value: activeCooks.length,
				change: calcChange(activeCooks.length, prevActiveCooks.length),
			},
			totalOrders: {
				value: totalOrders,
				change: calcChange(totalOrders, prevTotalOrders),
			},
			gmv: {
				value: gmv,
				change: calcChange(gmv, prevGmv),
			},
			cancellations: {
				value: cancelledOrders,
				change: calcChange(cancelledOrders, prevCancelled),
			},
			refunds: {
				value: refundedOrders,
				change: calcChange(refundedOrders, prevRefunded),
			},
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getOrderChart = async (req, res) => {
	try {
		const { start, end, zone } = req.query;

		const match = {
			createdAt: { $gte: new Date(start), $lte: new Date(end) },
		};

		if (zone) {
			match["deliveryAddress.region"] = zone;
		}

		const data = await Order.aggregate([
			{ $match: match },
			{
				$group: {
					_id: {
						date: {
							$dateToString: {
								format: "%Y-%m-%d",
								date: "$createdAt",
							},
						},
						status: "$status",
					},
					count: { $sum: 1 },
				},
			},
			{
				$group: {
					_id: "$_id.date",
					data: {
						$push: {
							status: "$_id.status",
							count: "$count",
						},
					},
				},
			},
			{ $sort: { _id: 1 } },
		]);

		res.json(data);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getFulfillmentTime = async (req, res) => {
	try {
		const { start, end } = req.query;

		const data = await Order.aggregate([
			{
				$match: {
					status: { $in: ["delivered", "picked_up"] },
					createdAt: { $gte: new Date(start), $lte: new Date(end) },
				},
			},
			{
				$project: {
					duration: {
						$divide: [
							{ $subtract: ["$updatedAt", "$createdAt"] },
							1000 * 60, // minutes
						],
					},
				},
			},
			{
				$group: {
					_id: null,
					avgTime: { $avg: "$duration" },
				},
			},
		]);

		res.json({
			averageFulfillmentTime: data[0]?.avgTime || 0,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getSystemAlerts = async (req, res) => {
	try {
		const [lateOrders, paymentFailures, pendingPayouts] = await Promise.all([
			Order.countDocuments({
				status: { $in: ["cooking", "ready"] },
				createdAt: {
					$lte: new Date(Date.now() - 60 * 60 * 1000),
				},
			}),
			Order.countDocuments({
				paymentStatus: "pending",
			}),
			CookProfile.countDocuments({
				walletBalance: { $gt: 0 },
			}),
		]);

		res.json({
			lateOrders,
			paymentFailures,
			pendingPayouts,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getAllOrders = async (req, res) => {
	try {
		const { page = 1, limit = 10, status, zone, start, end } = req.query;

		const query = {};

		if (status) query.status = status;

		if (zone) {
			query["deliveryAddress.region"] = zone;
		}

		if (start && end) {
			query.createdAt = {
				$gte: new Date(start),
				$lte: new Date(end),
			};
		}

		const orders = await Order.find(query)
			.populate("userId", "fullName phone")
			.populate("cookId", "fullName phone")
			.populate("mealItems.mealId", "name images price") // ✅ add this
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(Number(limit));

		const total = await Order.countDocuments(query);

		// ✅ Format response
		const formattedOrders = orders.map((order) => ({
			_id: order._id,
			user: order.userId,
			cook: order.cookId,
			totalAmount: order.totalAmount,
			status: order.status,
			paymentStatus: order.paymentStatus,
			deliveryType: order.deliveryType,
			deliveryAddress: order.deliveryAddress,
			createdAt: order.createdAt,

			mealItems: order.mealItems.map((item) => ({
				mealId: item.mealId?._id,
				name: item.mealId?.name,
				images: item.mealId?.images || [],
				price: item.price,
				quantity: item.quantity,
			})),
		}));

		res.json({
			page: Number(page),
			total,
			pages: Math.ceil(total / limit),
			orders: formattedOrders,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: error.message });
	}
};

export const getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate("userId", "fullName email")
			.populate("cookId", "fullName email")
			.populate("mealItems.mealId", "name images price");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		// Transform mealItems to include only what you need
		const formattedMealItems = order.mealItems.map((item) => ({
			mealId: item.mealId?._id,
			name: item.mealId?.name,
			images: item.mealId?.images || [],
			price: item.price,
			quantity: item.quantity,
		}));

		const formattedOrder = {
			_id: order._id,
			user: order.userId,
			cook: order.cookId,
			totalAmount: order.totalAmount,
			status: order.status,
			paymentStatus: order.paymentStatus,
			deliveryType: order.deliveryType,
			deliveryAddress: order.deliveryAddress,
			note: order.note,
			mealItems: formattedMealItems,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
		};

		res.status(200).json(formattedOrder);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: error.message });
	}
};

export const cancelOrder = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.status === "cancelled") {
			return res.status(400).json({ message: "Already cancelled" });
		}

		order.status = "cancelled";
		await order.save();

		res.json({ message: "Order cancelled successfully", order });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const issueRefund = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.paymentStatus !== "paid") {
			return res.status(400).json({
				message: "Only paid orders can be refunded",
			});
		}

		// 🔹 Call Paystack Refund API
		const response = await axios.post(
			"https://api.paystack.co/refund",
			{
				transaction: order.paymentReference, // VERY IMPORTANT
				amount: order.totalAmount * 100, // in kobo
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		// Save refund request reference
		order.refundReference = response.data.data.reference;
		order.refundStatus = "pending";
		await order.save();

		res.json({
			message: "Refund initiated. Awaiting confirmation.",
			data: response.data.data,
		});
	} catch (error) {
		res.status(500).json({
			message: error.response?.data || error.message,
		});
	}
};

export const getAtRiskOrders = async (req, res) => {
	try {
		const thresholdMinutes = 45;

		const orders = await Order.find({
			status: { $in: ["pending", "confirmed", "cooking"] },
			createdAt: {
				$lte: new Date(Date.now() - thresholdMinutes * 60 * 1000),
			},
		})
			.populate("userId", "fullName phone")
			.populate("cookId", "fullName phone");

		res.json(orders);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getAllMainOrders = async (req, res) => {
	try {
		const { status, paymentStatus, dateFrom, dateTo, cookId } = req.query;

		// Build dynamic filter
		const filter = {};

		if (status) filter.status = status;
		if (paymentStatus) filter.paymentStatus = paymentStatus;
		if (cookId) filter.cookId = cookId;
		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo) filter.createdAt.$lte = new Date(dateTo);

		// Fetch orders with populated references
		const orders = await Order.find(filter)
			.sort({ createdAt: -1 })
			.populate("userId", "fullName email phone profileImage")
			.populate("cookId", "fullName email phone profileImage")
			.populate("mealItems.mealId", "name description price images category");

		// Map to return clean response
		const data = orders.map((order) => ({
			orderId: order._id,
			status: order.status,
			paymentStatus: order.paymentStatus,
			totalAmount: order.totalAmount,
			serviceFee: order.serviceFee,
			deliveryFee: order.deliveryFee,
			tax: order.tax,
			discount: order.discount,
			note: order.note,
			deliveryType: order.deliveryType,
			deliveryAddress: order.deliveryAddress,
			mealItems: order.mealItems.map((item) => ({
				name: item.mealId.name,
				description: item.mealId.description,
				category: item.mealId.category,
				images: item.mealId.images,
				quantity: item.quantity,
				price: item.price,
			})),
			user: order.userId,
			cook: order.cookId,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
			refundReference: order.refundReference,
			friendPaymentCode: order.friendPaymentCode,
		}));

		res.status(200).json({ orders: data });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getSnapshot = async (req, res) => {
	try {
		const { date, zone } = req.query;

		// Use today by default
		const targetDate = date ? new Date(date) : new Date();
		const start = new Date(targetDate);
		start.setHours(0, 0, 0, 0);
		const end = new Date(targetDate);
		end.setHours(23, 59, 59, 999);

		const yesterdayStart = new Date(start);
		yesterdayStart.setDate(start.getDate() - 1);
		const yesterdayEnd = new Date(end);
		yesterdayEnd.setDate(end.getDate() - 1);

		// Orders today and yesterday
		const orderFilterToday = { createdAt: { $gte: start, $lte: end } };
		const orderFilterYesterday = {
			createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
		};
		if (zone) {
			orderFilterToday["deliveryAddress.city"] = zone;
			orderFilterYesterday["deliveryAddress.city"] = zone;
		}

		const ordersToday = await Order.find(orderFilterToday);
		const ordersYesterday = await Order.find(orderFilterYesterday);

		// Complaints (assuming negative reviews or cancelled orders)
		const complaintsToday = ordersToday.filter(
			(o) => o.status === "cancelled" || o.paymentStatus === "refunded",
		).length;
		const complaintsYesterday = ordersYesterday.filter(
			(o) => o.status === "cancelled" || o.paymentStatus === "refunded",
		).length;

		// Repeat customers
		const repeatCustomerIdsToday = [
			...new Set(
				ordersToday.filter((o) => o.userId).map((o) => o.userId.toString()),
			),
		];
		const repeatCustomerIdsYesterday = [
			...new Set(
				ordersYesterday.filter((o) => o.userId).map((o) => o.userId.toString()),
			),
		];

		const repeatPercentage =
			repeatCustomerIdsYesterday.length === 0
				? 0
				: (repeatCustomerIdsToday.length / repeatCustomerIdsYesterday.length) *
					100;

		// Average rating (from reviews)

		const avgRatingTodayAgg = await Review.aggregate([
			{
				$match: {
					createdAt: { $gte: start, $lte: end },
					targetType: "cook",
				},
			},
			{
				$group: {
					_id: null,
					avgRating: { $avg: "$rating" },
				},
			},
		]);
		const avgRatingYesterdayAgg = await Review.aggregate([
			{
				$match: {
					createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
					targetType: "cook",
				},
			},
			{
				$group: {
					_id: null,
					avgRating: { $avg: "$rating" },
				},
			},
		]);

		const avgRatingToday = avgRatingTodayAgg[0]?.avgRating || 0;
		const avgRatingYesterday = avgRatingYesterdayAgg[0]?.avgRating || 0;

		// At risk orders: orders pending > 2 hours or late
		const now = new Date();
		const atRiskOrders = ordersToday.filter(
			(o) =>
				(o.status === "pending" || o.status === "cooking") &&
				now - o.createdAt > 2 * 60 * 60 * 1000,
		);

		// Live orders
		const liveOrders = ordersToday
			.filter((o) => ["cooking", "ready"].includes(o.status))
			.map((o) => ({
				orderId: o._id,
				status: o.status,
				user: o.userId,
				cook: o.cookId,
				deliveryType: o.deliveryType,
				note: o.note,
			}));

		// Alerts
		const alerts = ordersToday
			.filter(
				(o) =>
					o.status === "cancelled" ||
					o.paymentStatus === "refunded" ||
					(o.status === "pending" && now - o.createdAt > 2 * 60 * 60 * 1000),
			)
			.map((o) => ({
				orderId: o._id,
				status: o.status,
				type:
					o.status === "cancelled"
						? "cook_cancellation"
						: o.paymentStatus === "refunded"
							? "payment_failure"
							: "late_order",
			}));

		// Zone activity: number of orders per city
		const zoneActivities = {};
		ordersToday.forEach((o) => {
			const cityName = o.deliveryAddress?.city || "Unknown";
			zoneActivities[cityName] = (zoneActivities[cityName] || 0) + 1;
		});

		// Cooks online / availability
		const cooksOnline = await CookProfile.find({ isAvailable: true });
		const totalCooks = await CookProfile.countDocuments();

		const availabilityPercentage =
			totalCooks === 0 ? 0 : (cooksOnline.length / totalCooks) * 100;

		// Orders per hour (basic)
		const ordersPerHour = {};
		ordersToday.forEach((o) => {
			const hour = o.createdAt.getHours();
			ordersPerHour[hour] = (ordersPerHour[hour] || 0) + 1;
		});

		res.status(200).json({
			avgRatingToday,
			avgRatingYesterday,
			complaintsToday,
			complaintsYesterday,
			repeatCustomerPercentage: repeatPercentage.toFixed(2),
			atRiskOrders: atRiskOrders.length,
			liveOrders,
			alerts,
			zoneActivities,
			totalActiveZones: Object.keys(zoneActivities).length,
			ordersPerHour,
			cooksOnline: cooksOnline.length,
			totalCooks,
			availabilityPercentage: availabilityPercentage.toFixed(2),
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// GET /api/admin/search?q=...
export const globalSearch = async (req, res) => {
	try {
		const { q } = req.query;

		if (!q || q.trim() === "") {
			return res.status(400).json({ message: "Search query is required" });
		}

		const searchRegex = new RegExp(q, "i");

		// Check if query is ObjectId (for direct lookup)
		const isObjectId = mongoose.Types.ObjectId.isValid(q);

		// ================= USERS =================
		const users = await User.find({
			$or: [
				{ fullName: searchRegex },
				{ email: searchRegex },
				{ phone: searchRegex },
			],
		})
			.limit(10)
			.select("fullName email phone");

		// ================= COOKS =================
		const cooks = await CookProfile.find({
			$or: [{ cookName: searchRegex }, { phone: searchRegex }],
		})
			.populate("userId", "fullName email phone")
			.limit(10);

		// ================= ORDERS =================
		const orderQuery = [];

		if (isObjectId) {
			orderQuery.push({ _id: q });
		}

		orderQuery.push(
			{ reference: searchRegex },
			{ paymentReference: searchRegex },
		);

		const orders = await Order.find({
			$or: orderQuery,
		})
			.populate("userId", "fullName email")
			.populate("cookId", "cookName")
			.limit(10);

		// ================= FORMAT RESPONSE =================
		const formattedUsers = users.map((u) => ({
			type: "user",
			id: u._id,
			name: u.fullName,
			email: u.email,
			phone: u.phone,
		}));

		const formattedCooks = cooks.map((c) => ({
			type: "cook",
			id: c._id,
			name: c.cookName || c.userId?.fullName,
			email: c.userId?.email,
			phone: c.phone || c.userId?.phone,
			isAvailable: c.isAvailable,
			rating: c.rating,
		}));

		const formattedOrders = orders.map((o) => ({
			type: "order",
			id: o._id,
			reference: o.reference,
			amount: o.totalAmount,
			paymentStatus: o.paymentStatus,
			user: o.userId?.fullName,
			cook: o.cookId?.cookName,
			createdAt: o.createdAt,
		}));

		res.status(200).json({
			users: formattedUsers,
			cooks: formattedCooks,
			orders: formattedOrders,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Search failed", error: error.message });
	}
};
