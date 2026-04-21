import cloudinary from "cloudinary";
import dotenv from "dotenv";
import Cart from "../models/Cart.js";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import Notification from "../models/Notification.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import User from "../models/User.js";
import { createAdminNotification } from "../utils/adminNotification.js";
dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// Update basic profile info
export const updateProfile = async (req, res) => {
	try {
		const updates = req.body;
		const user = await User.findById(req.user._id);
		if (!user) return res.status(404).json({ message: "User not found" });

		Object.assign(user, updates);
		await user.save();
		res.json({ message: "Profile updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Delete account (user or cook)
export const deleteAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { reason } = req.body;

		if (!reason) {
			return res.status(400).json({
				message: "Deletion reason is required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// OPTIONAL: fetch cook profile for payout logic
		const cookProfile = await CookProfile.findOne({ userId });

		// 🚨 0. Business Rule Checks
		if (cookProfile && cookProfile.walletBalance > 0) {
			return res.status(400).json({
				message: "Please withdraw your wallet balance before deleting account",
			});
		}

		// 1. Delete cook profile
		await CookProfile.deleteOne({ userId });

		// 2. Delete meals
		await Meal.deleteMany({ cookId: userId });

		// 3. Remove references
		await User.updateMany(
			{},
			{
				$pull: {
					savedCooks: userId,
					favorites: userId,
				},
			},
		);

		// 4. Delete related data
		await Promise.all([
			Order.deleteMany({ userId }),
			Order.deleteMany({ cookId: userId }),
			Cart.deleteMany({ userId }),
			Review.deleteMany({ userId }),
			Notification.deleteMany({ userId }),
			Notification.deleteMany({ "data.cookId": userId }),
			Notification.deleteMany({ "data.userId": userId }),
		]);

		// 6. Delete user
		await User.deleteOne({ _id: userId });

		// 7. Admin notification (async)
		createAdminNotification({
			title: "Account Deleted",
			body: `${user.fullName} deleted account. Reason: ${reason}`,
			type: "user",
			data: { userId },
		}).catch(console.error);

		// 8. Paystack payload (if needed for refund/payout tracking)
		const paystackPayload = {
			reference: `acct_delete_${userId}_${Date.now()}`,
			email: user.email,
			amount: 0, // set if refunding (kobo)
			metadata: {
				userId: userId.toString(),
				reason,
				type: "account_deletion",
			},
		};

		return res.json({
			message: "Account and all related data deleted successfully",
			paystackPayload, // return so frontend or service can act on it
		});
	} catch (error) {
		return res.status(500).json({ message: error.message });
	}
};

// Upload/Update profile image
export const updateProfileImage = async (req, res) => {
	try {
		if (!req.file)
			return res.status(400).json({ message: "No image uploaded" });

		const result = await cloudinary.v2.uploader.upload(req.file.path, {
			folder: "getameal/profile",
		});

		const user = await User.findByIdAndUpdate(
			req.user._id,
			{ profileImage: { url: result.secure_url, publicId: result.public_id } },
			{ new: true },
		);

		res.json({ message: "Profile image updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Upload/Update cover image
export const updateCoverImage = async (req, res) => {
	try {
		if (!req.file)
			return res.status(400).json({ message: "No image uploaded" });

		const result = await cloudinary.v2.uploader.upload(req.file.path, {
			folder: "getameal/cover",
		});

		const user = await User.findByIdAndUpdate(
			req.user._id,
			{ coverImage: { url: result.secure_url, publicId: result.public_id } },
			{ new: true },
		);

		res.json({ message: "Cover image updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update bio
export const updateBio = async (req, res) => {
	try {
		const { bio } = req.body;
		const user = await User.findByIdAndUpdate(
			req.user._id,
			{ bio },
			{ new: true },
		);
		res.json({ message: "Bio updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update location
export const updateLocation = async (req, res) => {
	try {
		const { coordinates, address } = req.body; // coordinates = [lng, lat]
		if (!Array.isArray(coordinates) || coordinates.length !== 2)
			return res.status(400).json({ message: "Invalid coordinates" });

		const user = await User.findByIdAndUpdate(
			req.user._id,
			{ location: { type: "Point", coordinates, address } },
			{ new: true },
		);

		res.json({ message: "Location updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get my profile
export const getMyProfile = async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("-password");

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		let cookProfile = null;

		if (user.isCook) {
			cookProfile = await CookProfile.findOne({ userId: user._id });
		}

		res.json({
			user,
			isCook: user.isCook,
			cookProfile,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

// Get user profile by ID
export const getUserProfile = async (req, res) => {
	try {
		const user = await User.findById(req.params.id).select("-password");

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		let cookProfile = null;

		if (user.isCook) {
			cookProfile = await CookProfile.findOne({ userId: user._id });
		}

		res.json({
			user,
			isCook: user.isCook,
			cookProfile,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export const getMyCart = async (req, res) => {
	try {
		const userId = req.user.id;

		const cart = await Cart.findOne({ user: userId }).populate("items.meal");

		if (!cart) {
			return res.json({ items: [], total: 0 });
		}

		// Calculate total securely on server
		const total = cart.items.reduce(
			(sum, item) => sum + item.price * item.quantity,
			0,
		);

		res.json({
			items: cart.items,
			total,
		});
	} catch (error) {
		res.status(500).json({ message: "Failed to fetch cart" });
	}
};
