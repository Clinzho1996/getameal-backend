import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import multer from "multer";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { createAdminNotification } from "../utils/adminNotification.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// Create Meal (Cook Only) with file upload
export const createMeal = async (req, res) => {
	try {
		if (!(req.user.role === "cook" || req.user.isCook)) {
			return res.status(403).json({ message: "Only cooks can create meals" });
		}

		let images = [];
		if (req.files && req.files.length > 0) {
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/meals",
				});
				images.push({ url: result.secure_url, publicId: result.public_id });
				fs.unlinkSync(file.path);
			}
		}

		const meal = new Meal({
			cookId: req.user._id,
			category: req.body.category,
			name: req.body.name,
			description: req.body.description,
			unitsPerQuantity: req.body.unitsPerQuantity,
			price: req.body.price,
			quantityLabel: req.body.quantityLabel,
			portionsTotal: req.body.portionsTotal,
			portionsRemaining: req.body.portionsTotal,
			cookingDate: req.body.cookingDate,
			pickupWindow: req.body.pickupWindow,
			deliveryRegions: req.body.deliveryRegions,
			images,
		});

		await createAdminNotification({
			title: "New Meal Created",
			body: `A new meal was created by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id },
		});

		await meal.save();
		res.status(201).json({ message: "Meal created successfully", meal });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all meals (public)
export const getMeals = async (req, res) => {
	try {
		const meals = await Meal.find()
			.populate("cookId", "fullName profileImage")
			.sort({ createdAt: -1 })
			.select(
				"name description price unitsPerQuantity images portionsRemaining category cookingDate pickupWindow deliveryRegions quantityLabel",
			);
		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all meals by cook ID
export const getMealsByCook = async (req, res) => {
	try {
		const cookId = req.params.cookId;

		const cook = await User.findOne({
			_id: cookId,
			$or: [{ role: "cook" }, { isCook: true }],
		});

		if (!cook) return res.status(404).json({ message: "Cook not found" });

		const meals = await Meal.find({ cookId: cook._id })
			.sort({ createdAt: -1 })
			.populate("cookId", "fullName profileImage location");

		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get single meal by ID
export const getMealById = async (req, res) => {
	try {
		const meal = await Meal.findById(req.params.id).populate(
			"cookId",
			"fullName profileImage location",
		);
		if (!meal) return res.status(404).json({ message: "Meal not found" });
		res.json(meal);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update meal (Cook Only & owner only)
export const updateMeal = async (req, res) => {
	try {
		const meal = await Meal.findById(req.params.id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		if (meal.cookId.toString() !== req.user._id.toString()) {
			return res.status(403).json({ message: "Not authorized" });
		}

		// ===== HANDLE IMAGE REPLACEMENT =====
		if (req.files && req.files.length > 0) {
			// 1. Delete old images from Cloudinary
			if (meal.images && meal.images.length > 0) {
				for (const img of meal.images) {
					if (img.publicId) {
						await cloudinary.v2.uploader.destroy(img.publicId);
					}
				}
			}

			// 2. Upload new images
			let newImages = [];
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/meals",
				});

				newImages.push({
					url: result.secure_url,
					publicId: result.public_id,
				});

				fs.unlinkSync(file.path);
			}

			// 3. Replace images array
			meal.images = newImages;
		}

		// ===== UPDATE OTHER FIELDS =====
		Object.assign(meal, req.body);

		// ===== PORTION LOGIC =====
		if (
			req.body.portionsTotal &&
			req.body.portionsTotal < meal.portionsRemaining
		) {
			meal.portionsRemaining = req.body.portionsTotal;
		}

		await meal.save();

		await createAdminNotification({
			title: "Meal Updated",
			body: `The meal "${meal.name}" was updated by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id },
		});

		res.json({ message: "Meal updated", meal });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: error.message });
	}
};

// Delete meal (Cook Only & owner only)
export const deleteMeal = async (req, res) => {
	try {
		const meal = await Meal.findById(req.params.id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		if (meal.cookId.toString() !== req.user._id.toString()) {
			return res
				.status(403)
				.json({ message: "Not authorized to delete this meal" });
		}

		await meal.deleteOne();

		await createAdminNotification({
			title: "Meal Deleted",
			body: `The meal "${meal.name}" was deleted by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id },
		});
		res.json({ message: "Meal deleted successfully" });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const duplicateMeal = async (req, res) => {
	try {
		const { id } = req.params;

		// Validate ID
		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "Invalid meal ID" });
		}

		// Find original meal
		const originalMeal = await Meal.findById(id);
		if (!originalMeal) {
			return res.status(404).json({ message: "Meal not found" });
		}

		// Ensure only owner can duplicate
		if (originalMeal.cookId.toString() !== req.user._id.toString()) {
			return res.status(403).json({ message: "Not authorized" });
		}

		// Duplicate meal
		const duplicatedMeal = new Meal({
			cookId: originalMeal.cookId,
			category: originalMeal.category,
			name: `${originalMeal.name} (Copy)`,
			description: originalMeal.description,
			unitsPerQuantity: originalMeal.unitsPerQuantity,
			price: originalMeal.price,
			quantityLabel: originalMeal.quantityLabel,
			portionsTotal: originalMeal.portionsTotal,
			portionsRemaining: originalMeal.portionsTotal, // reset
			cookingDate: originalMeal.cookingDate,
			pickupWindow: originalMeal.pickupWindow,
			deliveryRegions: originalMeal.deliveryRegions,
			images: originalMeal.images, // reuse images
			status: "open", // reset status
		});

		await createAdminNotification({
			title: "Meal Duplicated",
			body: `The meal "${originalMeal.name}" was duplicated by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: duplicatedMeal._id },
		});

		await duplicatedMeal.save();

		res.status(201).json({
			message: "Meal duplicated successfully",
			meal: duplicatedMeal,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Search meals
export const searchMeals = async (req, res) => {
	try {
		const { query } = req.query;
		if (!query) return res.status(400).json({ message: "Query is required" });

		const meals = await Meal.aggregate([
			{
				$lookup: {
					from: "foodcategories",
					localField: "category",
					foreignField: "_id",
					as: "categoryInfo",
				},
			},
			{ $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
			{
				$lookup: {
					from: "users",
					localField: "cookId",
					foreignField: "_id",
					as: "cookInfo",
				},
			},
			{ $unwind: "$cookInfo" },
			{
				$match: {
					$or: [
						{ name: { $regex: query, $options: "i" } },
						{ "categoryInfo.name": { $regex: query, $options: "i" } },
						{ "cookInfo.fullName": { $regex: query, $options: "i" } },
					],
				},
			},
			{
				$project: {
					name: 1,
					description: 1,
					price: 1,
					unitsPerQuantity: 1,
					images: 1,
					portionsRemaining: 1,
					"categoryInfo._id": 1,
					"categoryInfo.name": 1,
					"categoryInfo.image": 1,
					"cookInfo._id": 1,
					"cookInfo.fullName": 1,
					"cookInfo.profileImage": 1,
				},
			},
			{ $sort: { createdAt: -1 } },
		]);

		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get related meals
export const getRelatedMeals = async (req, res) => {
	try {
		const { id } = req.params;
		const meal = await Meal.findById(id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		const relatedMeals = await Meal.find({
			_id: { $ne: meal._id },
			status: "open",
			$or: [{ category: meal.category }, { cookId: meal.cookId }],
		})
			.populate("cookId", "fullName profileImage")
			.select(
				"name description price unitsPerQuantity images portionsRemaining category cookingDate quantityLabel",
			)
			.limit(6)
			.sort({ createdAt: -1 });

		res.json({ currentMeal: meal._id, relatedMeals });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Add meal to favorites
export const addFavoriteMeal = async (req, res) => {
	try {
		const userId = req.user.id;
		const { mealId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(mealId)) {
			return res.status(400).json({ message: "Invalid meal ID" });
		}

		// 1. Verify meal exists
		const mealExists = await Meal.exists({ _id: mealId });
		if (!mealExists) {
			return res.status(404).json({ message: "Meal not found" });
		}

		// 2. Add to favorites array in User model
		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $addToSet: { favorites: mealId } }, // $addToSet prevents duplicate favorites
			{ returnDocument: "after" },
		).select("favorites");

		res.json({
			message: "Meal added to favorites",
			favorites: updatedUser.favorites,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to add favorite meal", error: error.message });
	}
};

// Remove meal from favorites
export const removeFavoriteMeal = async (req, res) => {
	try {
		const userId = req.user.id;
		const { mealId } = req.params;

		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $pull: { favorites: mealId } }, // Atomic remove
			{ returnDocument: "after" },
		).select("favorites");

		res.json({
			message: "Meal removed from favorites",
			favorites: updatedUser.favorites,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to remove favorite meal",
			error: error.message,
		});
	}
};

// Get all favorite meals
export const getFavoriteMeals = async (req, res) => {
	try {
		const userId = req.user.id;

		// 1. Get the user and just the IDs first
		const user = await User.findById(userId).select("favorites");

		if (!user || !user.favorites || user.favorites.length === 0) {
			return res.json([]); // Return early if no IDs exist
		}

		// 2. Fetch the actual meals from the Meal collection using those IDs
		const favoriteMeals = await Meal.find({
			_id: { $in: user.favorites },
		}).populate("cookId", "fullName profileImage");

		res.json(favoriteMeals);
	} catch (error) {
		res.status(500).json({
			message: "Failed to fetch favorite meals",
			error: error.message,
		});
	}
};

export const getMealsByDateForCook = async (req, res) => {
	try {
		const cookId = req.user._id;
		const { date } = req.query;

		if (!date) return res.status(400).json({ message: "Date is required" });

		const start = new Date(date);
		start.setHours(0, 0, 0, 0);

		const end = new Date(date);
		end.setHours(23, 59, 59, 999);

		const meals = await Meal.find({
			cookId,
			cookingDate: { $gte: start, $lte: end },
		})
			.sort({ cookingDate: 1 })
			.select(
				"name description price images portionsRemaining cookingDate quantityLabel category status", // ✅ include status
			);

		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const updateMealStatus = async (req, res) => {
	try {
		const { status } = req.body; // "cooking" or "ready"
		const { id } = req.params;

		if (!["cooking", "ready", "closed", "open"].includes(status)) {
			return res.status(400).json({ message: "Invalid status" });
		}

		const meal = await Meal.findById(id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		// Only owner cook can update
		if (meal.cookId.toString() !== req.user._id.toString()) {
			return res.status(403).json({ message: "Not authorized" });
		}

		meal.status = status;
		await meal.save();

		await createAdminNotification({
			title: "Meal Status Updated",
			body: `The meal "${meal.name}" status was updated to "${status}" by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id, status },
		});

		res.json({ message: "Meal status updated", meal });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getOrdersByMeal = async (req, res) => {
	try {
		const { id } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "Invalid meal ID" });
		}

		const orders = await Order.find({ "mealItems.mealId": id })
			.populate("userId", "fullName email")
			.populate("cookId", "fullName email")
			.sort({ createdAt: -1 });

		res.json({ id, orders });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

const upload = multer({ dest: "uploads/" });

export const adminCreateMeal = [
	upload.array("images"), // "images" = name of file input in form-data
	async (req, res) => {
		try {
			const {
				cookId,
				category,
				name,
				description,
				unitsPerQuantity,
				price,
				quantityLabel,
				portionsTotal,
				cookingDate,
				pickupWindow,
				deliveryRegions,
			} = req.body;

			if (!cookId || !category || !name || !price) {
				return res
					.status(400)
					.json({ message: "cookId, category, name, and price are required" });
			}

			const cook = await CookProfile.findById(cookId);
			if (!cook) return res.status(404).json({ message: "Cook not found" });

			// Handle images
			let images = [];
			if (req.files && req.files.length > 0) {
				for (const file of req.files) {
					const result = await cloudinary.v2.uploader.upload(file.path, {
						folder: "getameal/meals",
					});
					images.push({ url: result.secure_url, publicId: result.public_id });
					fs.unlinkSync(file.path); // remove local file
				}
			}

			// Handle deliveryRegions safely
			let parsedDeliveryRegions = [];
			if (deliveryRegions) {
				if (typeof deliveryRegions === "string") {
					try {
						parsedDeliveryRegions = JSON.parse(deliveryRegions);
						if (!Array.isArray(parsedDeliveryRegions))
							parsedDeliveryRegions = [parsedDeliveryRegions];
					} catch {
						// fallback: split by comma if it's a comma-separated string
						parsedDeliveryRegions = deliveryRegions
							.split(",")
							.map((s) => s.trim());
					}
				} else if (Array.isArray(deliveryRegions)) {
					parsedDeliveryRegions = deliveryRegions;
				}
			}
			// Create meal
			const meal = new Meal({
				cookId: cook._id,
				category,
				name,
				description,
				unitsPerQuantity: parseInt(unitsPerQuantity),
				price: parseFloat(price),
				quantityLabel,
				portionsTotal: parseInt(portionsTotal),
				portionsRemaining: parseInt(portionsTotal),
				cookingDate: cookingDate ? new Date(cookingDate) : undefined,
				pickupWindow,
				deliveryRegions: parsedDeliveryRegions,
				images,
			});

			await meal.save();

			// Notify admin (or other admins)
			await createAdminNotification({
				title: "New Meal Created by Admin",
				body: `Admin created a meal for cook ${cook.cookName}`,
				type: "meal",
				data: { mealId: meal._id, cookId: cook._id },
			});

			res
				.status(201)
				.json({ message: "Meal created successfully", meal, cookId: cook._id });
		} catch (error) {
			console.error("Admin create meal error:", error);
			res.status(500).json({ message: "Server error", error: error.message });
		}
	},
];
