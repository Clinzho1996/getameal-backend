// routes/cookRoutes.js
import express from "express";
import {
	addCookBankAccount,
	deleteCookBankAccount,
	getCookBankDetails,
	updateCookBankAccount,
} from "../controllers/bankController.js";
import {
	becomeCook,
	getAllCooks,
	getCookById,
	getCookKYCStatus,
	referCook,
	updateCookProfile,
	updateCookProfileWithImages,
} from "../controllers/cookController.js";
import protect from "../middleware/auth.js";
import { uploadMiddleware } from "../middleware/upload.js";

const router = express.Router();

// Define the fields for different upload scenarios
const becomeCookFields = [
	{ name: "profilePhoto", maxCount: 1 },
	{ name: "coverPhoto", maxCount: 1 },
	{ name: "kitchenPhotos", maxCount: 3 },
	{ name: "cacImage", maxCount: 1 },
];

const profileUpdateFields = [
	{ name: "profilePhoto", maxCount: 1 },
	{ name: "coverPhoto", maxCount: 1 },
	{ name: "kitchenPhotos", maxCount: 3 },
];

// Become a cook - using the uploadMiddleware
router.post("/become", protect, uploadMiddleware(becomeCookFields), becomeCook);

// Update cook profile with images
router.put(
	"/profile-with-images",
	protect,
	uploadMiddleware(profileUpdateFields),
	updateCookProfileWithImages,
);

// Other routes
router.get("/kyc-status", protect, getCookKYCStatus);
router.post("/referral", protect, referCook);
router.post("/bank", protect, addCookBankAccount);
router.get("/bank", protect, getCookBankDetails);
router.put("/bank", protect, updateCookBankAccount);
router.delete("/bank", protect, deleteCookBankAccount);
router.patch("/update", protect, updateCookProfile);
router.get("/:id", getCookById);
router.get("/", getAllCooks);

export default router;
