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

		const cart = await Cart.findOne({ user: userId }).populate({
			path: "items.meal",
			populate: {
				path: "cookId",
				select: "fullName email phone",
			},
		});

		if (!cart) {
			return res.json({
				success: true,
				items: [],
				total: 0,
				validation: {
					hasMixedTypes: false,
					cooks: [],
					warnings: [],
					canCheckout: true,
				},
			});
		}

		let total = 0;
		const cookDeliveryTypes = new Map();

		// Analyze cart items
		for (const item of cart.items) {
			if (!item.meal) continue;

			const meal = item.meal;
			const cookId = meal.cookId?._id?.toString() || meal.cookId?.toString();
			if (!cookId) continue;

			total += item.price * item.quantity;

			if (!cookDeliveryTypes.has(cookId)) {
				const cookName = meal.cookId?.fullName || "Cook";
				const cookProfile = await CookProfile.findOne({ userId: cookId });
				const displayName = cookProfile?.cookDisplayName || cookName;

				cookDeliveryTypes.set(cookId, {
					cookName: displayName,
					cookId: cookId,
					hasPickupOnly: false,
					hasDeliveryOnly: false,
					items: [],
				});
			}

			const cookData = cookDeliveryTypes.get(cookId);
			const deliveryMode = meal.deliveryMode || "both";

			if (deliveryMode === "pickup_only") {
				cookData.hasPickupOnly = true;
			} else if (deliveryMode === "delivery_only") {
				cookData.hasDeliveryOnly = true;
			} else {
				// both
				cookData.hasPickupOnly = true;
				if (meal.deliveryRegions && meal.deliveryRegions.length > 0) {
					cookData.hasDeliveryOnly = true;
				}
			}

			cookData.items.push({
				mealId: meal._id,
				name: meal.name,
				quantity: item.quantity,
				price: item.price,
				deliveryMode: deliveryMode,
				deliveryRegions: meal.deliveryRegions || [],
				image: meal.images?.[0]?.url || null,
				status: meal.status,
			});
		}

		// Generate validation warnings
		const warnings = [];
		const cookSummaries = [];
		let hasMixedTypes = false;
		let canCheckout = true;

		for (const [cookId, data] of cookDeliveryTypes) {
			const isMixed = data.hasPickupOnly && data.hasDeliveryOnly;

			if (isMixed) {
				hasMixedTypes = true;
				canCheckout = false;
				warnings.push(
					`Your cart has both pickup and delivery items from "${data.cookName}". Please remove items to have only one delivery type from this cook.`,
				);
			}

			let suggestedDeliveryType = null;
			if (data.hasPickupOnly && !data.hasDeliveryOnly) {
				suggestedDeliveryType = "pickup";
			} else if (!data.hasPickupOnly && data.hasDeliveryOnly) {
				suggestedDeliveryType = "delivery";
			}

			cookSummaries.push({
				cookId: cookId,
				cookName: data.cookName,
				hasPickupOnly: data.hasPickupOnly,
				hasDeliveryOnly: data.hasDeliveryOnly,
				isMixed: isMixed,
				suggestedDeliveryType: suggestedDeliveryType,
				itemCount: data.items.length,
				items: data.items,
			});
		}

		const formattedItems = cart.items
			.filter((item) => item.meal)
			.map((item) => {
				const meal = item.meal;
				const cookId = meal.cookId?._id?.toString() || meal.cookId?.toString();
				const cookData = cookDeliveryTypes.get(cookId);
				const deliveryMode = meal.deliveryMode || "both";

				return {
					_id: item._id,
					meal: {
						_id: meal._id,
						name: meal.name,
						price: meal.price,
						description: meal.description,
						images: meal.images || [],
						status: meal.status,
						deliveryMode: deliveryMode,
						deliveryRegions: meal.deliveryRegions || [],
						cookingDate: meal.cookingDate,
						pickupWindow: meal.pickupWindow,
						portionsRemaining: meal.portionsRemaining,
						portionsTotal: meal.portionsTotal,
					},
					quantity: item.quantity,
					price: item.price,
					subtotal: item.price * item.quantity,
					cookName: cookData?.cookName || meal.cookId?.fullName || "Cook",
					deliveryType:
						deliveryMode === "pickup_only"
							? "pickup"
							: deliveryMode === "delivery_only"
								? "delivery"
								: "both",
				};
			});

		res.json({
			success: true,
			items: formattedItems,
			total: total,
			itemCount: formattedItems.length,
			validation: {
				hasMixedTypes: hasMixedTypes,
				cooks: cookSummaries,
				warnings: warnings,
				canCheckout: canCheckout && formattedItems.length > 0,
				message: canCheckout
					? "Your cart is ready for checkout"
					: "Please fix the issues in your cart before checkout",
			},
		});
	} catch (error) {
		console.error("Get cart error:", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch cart",
			error: error.message,
		});
	}
};
