import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
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
		if (req.user.role !== "cook") {
			return res.status(403).json({ message: "Only cooks can create meals" });
		}

		let images = [];
		if (req.files && req.files.length > 0) {
			// Upload each image to Cloudinary
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/meals",
				});
				images.push({ url: result.secure_url, publicId: result.public_id });

				// Remove file from server
				fs.unlinkSync(file.path);
			}
		}

		const meal = new Meal({
			cookId: req.user._id,
			category: req.body.category,
			name: req.body.name,
			description: req.body.description,
			price: req.body.price,
			quantityLabel: req.body.quantityLabel,
			portionsTotal: req.body.portionsTotal,
			portionsRemaining: req.body.portionsTotal,
			cookingDate: req.body.cookingDate,
			pickupWindow: req.body.pickupWindow,
			deliveryRegions: req.body.deliveryRegions,
			images, // store Cloudinary URLs
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
			.sort({ createdAt: -1 });
		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all meals by cook ID
export const getMealsByCook = async (req, res) => {
  try {
    const cook = await User.findById(req.params.cookId);
    if (!cook || cook.role !== "cook")
      return res.status(404).json({ message: "Cook not found" });

    const meals = await Meal.find({ cookId: cook._id }).sort({ createdAt: -1 });
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
			"fullName profileImage",
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

		if (meal.cookId.toString() !== req.user._id.toString())
			return res
				.status(403)
				.json({ message: "Not authorized to update this meal" });

		Object.assign(meal, req.body);
		// Ensure portionsRemaining isn't higher than portionsTotal
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

		if (meal.cookId.toString() !== req.user._id.toString())
			return res
				.status(403)
				.json({ message: "Not authorized to delete this meal" });

		await meal.deleteOne();
		res.json({ message: "Meal deleted successfully" });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const searchMeals = async (req, res) => {
	try {
		const { query } = req.query;

		if (!query) return res.status(400).json({ message: "Query is required" });

		// Aggregate to search across meal name, category name, and cook fullName
		const meals = await Meal.aggregate([
			{
				$lookup: {
					from: "foodcategories", // MongoDB collection name for FoodCategory
					localField: "category",
					foreignField: "_id",
					as: "categoryInfo",
				},
			},
			{ $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
			{
				$lookup: {
					from: "users", // MongoDB collection name for User
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
		console.error(error);
		res.status(500).json({ message: error.message });
	}
};
