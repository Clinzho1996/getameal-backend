// controllers/cookController.js
import User from "../models/User.js";

// Get single cook by ID
export const getCookById = async (req, res) => {
	try {
		const cook = await User.findOne({ _id: req.params.id, role: "cook" });
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		res.json(cook);
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
		res.json(cooks);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
// Become a cook
export const becomeCook = async (req, res) => {
	try {
		const { cookAddress, cookingExperience, availableForCooking, payoutBank } =
			req.body;

		const user = await User.findById(req.user.id);
		if (!user) return res.status(404).json({ message: "User not found" });

		user.role = "cook";
		user.cookAddress = cookAddress;
		user.cookingExperience = cookingExperience;
		user.availableForCooking = availableForCooking;
		user.cookSince = new Date();
		user.payoutBank = payoutBank;

		await user.save();

		res.json({ message: "You are now a cook", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
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
