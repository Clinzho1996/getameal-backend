// controllers/cookController.js
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

// Get single cook by ID
export const getCookById = async (req, res) => {
	try {
		const cook = await User.findOne({
			_id: req.params.id,
			role: "cook",
		});

		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}

		const cookProfile = await CookProfile.findOne({
			userId: cook._id,
		});

		res.json({
			...cook.toObject(),
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
		const cooks = await User.find({ role: "cook" }).select(
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
		} = req.body;

		const userId = req.user.id;

		if (!cookName || !phone || !address || !experience) {
			return res.status(400).json({
				message: "Cook name, phone, address and experience are required",
			});
		}

		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		// Check if already applied
		const existingCook = await CookProfile.findOne({ userId });

		if (existingCook) {
			return res.status(400).json({
				message: "You have already applied to become a cook",
			});
		}

		const cookProfile = await CookProfile.create({
			userId,
			availablePickup: true,
			schedule: startImmediately
				? ["Immediate"]
				: availableDate
					? [availableDate]
					: [],
			isApproved: false,
		});

		// Update user basic cook info
		user.role = "cook";
		user.fullName = cookName;
		user.phone = phone;
		user.cookAddress = address;
		user.cookingExperience = experience;
		user.availableForCooking = startImmediately ? new Date() : availableDate;

		await user.save();

		res.status(201).json({
			message: "Application submitted. Awaiting admin approval.",
			status: "pending_approval",
			cookProfile,
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

		const user = await User.findById(userId);

		if (!user.favorites.includes(cookId)) {
			user.favorites.push(cookId);
			await user.save();
		}

		res.json({ message: "Cook added to favorites" });
	} catch (error) {
		res.status(500).json({ message: "Failed to add favorite" });
	}
};

export const removeFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		const user = await User.findById(userId);

		user.favorites = user.favorites.filter((id) => id.toString() !== cookId);

		await user.save();

		res.json({ message: "Cook removed from favorites" });
	} catch (error) {
		res.status(500).json({ message: "Failed to remove favorite" });
	}
};

export const getFavoriteCooks = async (req, res) => {
	try {
		const userId = req.user.id;

		const user = await User.findById(userId).populate({
			path: "favorites",
			select: "name email profileImage rating role",
		});

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		res.json(user.favorites);
	} catch (error) {
		res.status(500).json({ message: "Failed to fetch favorites" });
	}
};
