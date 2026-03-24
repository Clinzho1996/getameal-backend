import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import Meal from "../models/Meal.js";
import User from "../models/User.js";

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
			return res
				.status(403)
				.json({ message: "Not authorized to update this meal" });
		}

		Object.assign(meal, req.body);

		if (
			req.body.portionsTotal &&
			req.body.portionsTotal < meal.portionsRemaining
		) {
			meal.portionsRemaining = req.body.portionsTotal;
		}

		await meal.save();
		res.json({ message: "Meal updated", meal });
	} catch (error) {
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
		res.json({ message: "Meal deleted successfully" });
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

		if (!date) {
			return res.status(400).json({ message: "Date is required" });
		}

		// Normalize date to start and end of day
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
				"name description price images portionsRemaining cookingDate quantityLabel category",
			);

		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
