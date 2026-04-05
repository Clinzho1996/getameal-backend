import { Resend } from "resend";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import WalletTransaction from "../models/WalletTransaction.js";

// Helper for Resend
let resendInstance = null;

const getResendInstance = () => {
	if (!resendInstance) {
		if (!process.env.RESEND_API_KEY) {
			throw new Error("Missing RESEND_API_KEY environment variable");
		}
		resendInstance = new Resend(process.env.RESEND_API_KEY);
	}
	return resendInstance;
};

// ------------------ Stats ------------------
export const getCookStats = async (req, res) => {
	try {
		const { dateFrom, dateTo, city } = req.query;

		const startDate = dateFrom ? new Date(dateFrom) : new Date();
		startDate.setHours(0, 0, 0, 0);

		const endDate = dateTo ? new Date(dateTo) : new Date();
		endDate.setHours(23, 59, 59, 999);

		// Filter cooks by city if provided
		const cookFilter = {};
		if (city) {
			cookFilter["location.address"] = { $regex: city, $options: "i" };
		}

		const cooks = await CookProfile.find(cookFilter);

		const cookIds = cooks.map((c) => c._id);

		// Orders within the period for these cooks
		const orders = await Order.find({
			cookId: { $in: cookIds },
			createdAt: { $gte: startDate, $lte: endDate },
		});

		const stats = {
			activeCooks: cooks.filter((c) => c.isAvailable).length,
			totalOrders: orders.length,
			amountToday: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
			cancellations: orders.filter((o) => o.status === "cancelled").length,
			refunds: orders.filter((o) => o.paymentStatus === "refunded").length,
			GMV: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0), // gross merchandise value
		};

		res.status(200).json({ stats });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Fetch all cooks ------------------
export const getAllCooks = async (req, res) => {
	try {
		const {
			status, // active / inactive
			verification, // pending / verified
			city, // filter by city (address field)
			sortBy, // newest / oldest / mostOrders / highestRating / lastActive
			dateFrom,
			dateTo,
			isAvailable, // true / false
		} = req.query;

		// Build filter dynamically
		const filter = {};

		if (status) {
			filter.isAvailable = status === "active";
		}

		if (verification) {
			filter.isApproved = verification === "verified";
		}

		if (city) {
			// Case-insensitive substring match on address
			filter["location.address"] = { $regex: city, $options: "i" };
		}

		if (typeof isAvailable !== "undefined") {
			filter.isAvailable = isAvailable === "true";
		}

		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo) filter.createdAt.$lte = new Date(dateTo);

		// Sorting
		const sort = {};
		switch (sortBy) {
			case "newest":
				sort.createdAt = -1;
				break;
			case "oldest":
				sort.createdAt = 1;
				break;
			case "mostOrders":
				sort.ordersCount = -1;
				break;
			case "highestRating":
				sort.rating = -1;
				break;
			case "lastActive":
				sort.updatedAt = -1;
				break;
			default:
				sort.createdAt = -1;
		}

		// Fetch cooks
		const cooks = await CookProfile.find(filter)
			.sort(sort)
			.populate("userId", "fullName email phone profileImage");

		// Format response
		const data = cooks.map((cook) => ({
			cookId: cook._id,
			name: cook.cookName,
			phone: cook.phone,
			email: cook.email,
			profileImage: cook.profileImage,
			location: cook.location,
			isAvailable: cook.isAvailable,
			isApproved: cook.isApproved,
			rating: cook.rating,
			ordersCount: cook.ordersCount,
			walletBalance: cook.walletBalance,
			createdAt: cook.createdAt,
			updatedAt: cook.updatedAt,
		}));

		res.status(200).json({ cooks: data });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Fetch cook by ID ------------------
export const getCookById = async (req, res) => {
	try {
		const { cookId } = req.params;

		// Get the cook profile and populate user info
		const cook = await CookProfile.findById(cookId).populate(
			"userId",
			"fullName email phone profileImage",
		);

		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}

		// Get meals created by this cook
		const meals = await Meal.find({ cookId: cook.userId._id }) // match the User ID
			.select(
				"name description price images category status portionsRemaining createdAt",
			)
			.sort({ createdAt: -1 });

		// Format meals if needed
		const formattedMeals = meals.map((meal) => ({
			_id: meal._id,
			name: meal.name,
			description: meal.description,
			category: meal.category,
			price: meal.price,
			images: meal.images || [],
			status: meal.status,
			portionsRemaining: meal.portionsRemaining,
			createdAt: meal.createdAt,
		}));

		res.status(200).json({
			cook,
			meals: formattedMeals,
			totalMeals: formattedMeals.length,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Message cook ------------------
export const messageCook = async (req, res) => {
	try {
		const resend = getResendInstance();
		const { cookId } = req.params;
		const { subject, message } = req.body;
		const cook = await CookProfile.findById(cookId).populate(
			"userId",
			"email fullName",
		);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		await resend.emails.send({
			from: process.env.EMAIL_FROM,
			to: cook.userId.email,
			subject,
			html: `<h2>Hello ${cook.userId.fullName}</h2><p>${message}</p>`,
		});

		res.status(200).json({ message: "Email sent successfully" });
	} catch (error) {
		console.error(error);
		res
			.status(500)
			.json({ message: "Failed to send email", error: error.message });
	}
};

// ------------------ Add note ------------------
export const addCookNote = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { note } = req.body;
		const cook = await CookProfile.findById(cookId);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		cook.notes = cook.notes || [];
		cook.notes.push({ note, createdAt: new Date() });
		await cook.save();

		res.status(200).json({ message: "Note added", notes: cook.notes });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Change status ------------------
export const changeCookStatus = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { action } = req.body;
		const cook = await CookProfile.findById(cookId);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		if (action === "suspend") cook.isAvailable = false;
		else if (action === "activate") cook.isAvailable = true;
		else if (action === "setActive") cook.isApproved = true;
		else if (action === "setInactive") cook.isApproved = false;
		else return res.status(400).json({ message: "Invalid action" });

		await cook.save();
		res.status(200).json({
			message: `Cook ${action}`,
			status: cook.isApproved ? "approved" : "rejected",
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Credit cook wallet ------------------
export const creditCookWallet = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { amount, reason, note } = req.body;

		const cook = await CookProfile.findById(cookId);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		cook.walletBalance += amount;
		await cook.save();

		await WalletTransaction.create({
			cookId: cook._id,
			type: "credit",
			amount,
			reference: reason,
			note,
		});

		

		res.status(200).json({
			message: "Cook wallet credited",
			walletBalance: cook.walletBalance,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
