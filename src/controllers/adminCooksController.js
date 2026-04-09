import { nanoid } from "nanoid";
import { Resend } from "resend";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
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
export const changeCookApprovalStatus = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { action } = req.body; // setActive | setInactive

		const cook = await CookProfile.findById(cookId).populate("userId");
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		if (action === "setActive") cook.isApproved = true;
		else if (action === "setInactive") cook.isApproved = false;
		else return res.status(400).json({ message: "Invalid action" });

		await cook.save();

		res.status(200).json({
			message: `Cook ${action === "setActive" ? "activated" : "deactivated"} successfully`,
			status: cook.isApproved ? "approved" : "rejected",
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ===============================
// SUSPEND / UNSUSPEND COOK
// ===============================
export const suspendCook = async (req, res) => {
	const resend = getResendInstance();
	try {
		const { cookId } = req.params;
		const { action, reason, note, notifyCook = true } = req.body;
		// action: suspend | activate

		const cook = await CookProfile.findById(cookId).populate("userId");
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		if (action === "suspend") {
			if (!reason)
				return res.status(400).json({ message: "Reason is required" });
			cook.isSuspended = true;
			cook.suspensionReason = reason;
			cook.suspensionNote = note || null;

			// send email if notifyCook is true
			if (notifyCook && cook.userId?.email) {
				const subject = "Your account has been suspended";
				const message = `<p>Your cooking account has been suspended for the following reason:</p>
					<p><strong>${reason}</strong></p>
					${note ? `<p>Note: ${note}</p>` : ""}
					<p>Please contact support if you believe this is an error.</p>`;

				await resend.emails.send({
					from: process.env.EMAIL_FROM,
					to: cook.userId.email,
					subject,
					html: `<h2>Hello ${cook.userId.fullName}</h2>${message}`,
				});
			}
		} else if (action === "activate") {
			cook.isSuspended = false;
			cook.suspensionReason = null;
			cook.suspensionNote = null;
		} else {
			return res.status(400).json({ message: "Invalid action" });
		}

		await cook.save();

		res.status(200).json({
			message: `Cook ${action} successfully`,
			status: cook.isSuspended ? "suspended" : "active",
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

export const adminCreateCook = async (req, res) => {
	const resend = getResendInstance();

	try {
		const {
			email,
			fullName,
			phone,
			address,
			experience,
			startImmediately = true,
			availableDate,
			latitude,
			longitude,
			referralCode,
			notifyUser = true,
		} = req.body;

		if (!email || !fullName || !phone || !address || !experience) {
			return res.status(400).json({
				message: "Email, full name, phone, address and experience are required",
			});
		}

		// Check if user exists
		let user = await User.findOne({ email });
		let plainPassword = nanoid(10); // always generate a password

		if (!user) {
			// Create a new user
			user = await User.create({
				email,
				fullName,
				phone,
				password: plainPassword,
				role: "user",
				isCook: true,
			});
		} else {
			// Update existing user to isCook and reset password
			user.isCook = true;
			user.password = plainPassword; // temporary password
			await user.save();
		}

		// Create or update cook profile
		let cookProfile = await CookProfile.findOne({ userId: user._id });
		if (!cookProfile) {
			cookProfile = await CookProfile.create({
				userId: user._id,
				cookName: fullName,
				phone,
				cookAddress: address,
				cookingExperience: experience,
				availablePickup: true,
				schedule: startImmediately
					? ["Immediate"]
					: availableDate
						? [availableDate]
						: [],
				isApproved: true,
				isAvailable: true,
				location:
					latitude && longitude
						? {
								type: "Point",
								coordinates: [parseFloat(longitude), parseFloat(latitude)],
								address,
							}
						: undefined,
				availableForCooking: startImmediately ? new Date() : availableDate,
			});
		}

		// Send email to user if notifyUser
		if (notifyUser) {
			const subject = "Your Cook Profile Has Been Created!";
			const message = `
        <p>Hello ${fullName},</p>
        <p>Your cook profile has been created by admin.</p>
        <p>Your login password: <strong>${plainPassword}</strong></p>
        <p>Address: ${address}</p>
        <p>Experience: ${experience}</p>
      `;

			await resend.emails.send({
				from: process.env.EMAIL_FROM,
				to: email,
				subject,
				html: message,
			});
		}

		res.status(201).json({
			message: "Cook profile created successfully",
			user: { id: user._id, email: user.email, fullName: user.fullName },
			cookProfile,
		});
	} catch (error) {
		console.error("Admin create cook error:", error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
