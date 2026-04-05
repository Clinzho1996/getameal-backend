// controllers/cookController.js
import crypto from "crypto";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

// Get single cook by ID
// Get single cook by ID
export const getCookById = async (req, res) => {
	try {
		const cook = await User.findOne({
			_id: req.params.id,
			$or: [{ role: "cook" }, { isCook: true }],
		});

		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}

		const cookProfile = await CookProfile.findOne({
			userId: cook._id,
		});

		const { payoutBank, ...userData } = cook.toObject();
		res.json({
			...userData,
			cookProfile,
			bankDetails: cookProfile?.bankDetails || null,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all cooks
export const getAllCooks = async (req, res) => {
	try {
		const cooks = await User.find({
			$or: [{ role: "cook" }, { isCook: true }],
		}).select(
			"_id fullName profileImage cookAddress cookingExperience availableForCooking",
		);

		const cookIds = cooks.map((c) => c._id);

		const cookProfiles = await CookProfile.find({
			userId: { $in: cookIds },
		});

		const merged = cooks.map((cook) => {
			const profile = cookProfiles.find(
				(p) => p.userId.toString() === cook._id.toString(),
			);

			return {
				...cook.toObject(),
				rating: profile?.rating || 0,
				ordersCount: profile?.ordersCount || 0,
				bankDetails: profile?.bankDetails || null,
				isApproved: profile?.isApproved || false,
			};
		});

		res.json(merged);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const referCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId);

		if (!user) return res.status(404).json({ message: "User not found" });

		// If user already has a referral code, return it
		if (!user.referralCode) {
			user.referralCode =
				"REF-" + crypto.randomBytes(3).toString("hex").toUpperCase();
			await user.save();
		}

		res.json({
			message: "Referral code generated",
			referralCode: user.referralCode,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
// Become a cook

export const becomeCook = async (req, res) => {
	try {
		const {
			cookName,
			phone,
			address,
			experience,
			startImmediately,
			availableDate,
			latitude,
			longitude,
			referralCode,
		} = req.body;

		const userId = req.user.id;

		if (!cookName || !phone || !address || !experience) {
			return res.status(400).json({
				message: "Cook name, phone, address and experience are required",
			});
		}

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		// Check if already applied
		const existingCook = await CookProfile.findOne({ userId });
		if (existingCook) {
			return res.status(400).json({
				message: "You have already applied to become a cook",
			});
		}

		// Create cook profile
		const cookProfile = await CookProfile.create({
			userId,
			cookName,
			phone,
			cookAddress: address,
			cookingExperience: experience,
			availablePickup: true,
			schedule: startImmediately
				? ["Immediate"]
				: availableDate
					? [availableDate]
					: [],
			isApproved: false,
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

		// Update user flag only
		user.isCook = true;
		// Optionally keep role as "user" to avoid overwriting user info
		await user.save();

		res.status(201).json({
			message: "Cook application submitted. Awaiting admin approval.",
			status: "pending_approval",
			cookProfile,
			userLocation: cookProfile.location || null,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to submit cook application",
			error: error.message,
		});
	}
};

// Update cook profile
export const updateCookProfile = async (req, res) => {
	try {
		const updates = req.body;

		const user = await User.findById(req.user.id);
		if (!user) return res.status(404).json({ message: "User not found" });

		Object.keys(updates).forEach((key) => {
			user[key] = updates[key];
		});

		await user.save();

		res.json({ message: "Cook profile updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const addFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(cookId)) {
			return res.status(400).json({ message: "Invalid cook ID" });
		}

		// 1. Verify the target user exists and is actually a cook
		const cookExists = await User.exists({ _id: cookId, isCook: true });
		if (!cookExists) {
			return res.status(404).json({ message: "Cook not found" });
		}

		// 2. Add to savedCooks (using $addToSet to prevent duplicates)
		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $addToSet: { savedCooks: cookId } }, // Targeting the correct field
			{ returnDocument: "after" },
		).select("savedCooks");

		res.json({
			message: "Cook saved to your list",
			savedCooks: updatedUser.savedCooks,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to save cook", error: error.message });
	}
};
// Get all favorite cooks
export const getFavoriteCooks = async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId).select("savedCooks");

		if (!user || !user.savedCooks || user.savedCooks.length === 0) {
			return res.json([]);
		}

		// Pass savedCooks to your helper
		const favoriteCooks = await getFavoriteCooksHelper(user.savedCooks);
		res.json(favoriteCooks);
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to fetch saved cooks", error: error.message });
	}
};

// Remove a cook from favorites
export const removeFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $pull: { savedCooks: cookId } }, // Targeting the correct field
			{ returnDocument: "after" },
		).select("savedCooks");

		const favoriteCooks = await getFavoriteCooksHelper(updatedUser.savedCooks);

		res.json({
			message: "Cook removed from saved list",
			savedCooks: favoriteCooks,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to remove cook", error: error.message });
	}
};

const getFavoriteCooksHelper = async (favoriteIds) => {
	if (!favoriteIds || favoriteIds.length === 0) return [];

	// Convert all strings to ObjectIds safely
	const ids = favoriteIds.map((id) => new mongoose.Types.ObjectId(id));

	// Find the Users
	const favoriteUsers = await User.find({
		_id: { $in: ids },
		isCook: true,
	})
		.select("_id fullName profileImage isCook")
		.lean();

	// Find the corresponding Cook Profiles
	const cookProfiles = await CookProfile.find({
		userId: { $in: ids },
	}).lean();

	// Merge them
	return favoriteUsers.map((user) => {
		const profile = cookProfiles.find(
			(p) => p.userId.toString() === user._id.toString(),
		);
		return {
			...user,
			cookProfile: profile || null,
		};
	});
};
