import express from "express";
import multer from "multer";
import {
	addCookBankAccount,
	deleteCookBankAccount,
	updateCookBankAccount,
} from "../controllers/bankController.js";
import {
	becomeCook,
	getAllCooks,
	getCookById,
	getCookKYCStatus,
	referCook,
	updateCookProfile,
} from "../controllers/cookController.js";
import protect from "../middleware/auth.js";

const upload = multer({ dest: "uploads/" });

const router = express.Router();

// Become a cook
router.post(
	"/become",
	protect,
	upload.fields([
		{ name: "profilePhoto", maxCount: 1 },
		{ name: "coverPhoto", maxCount: 1 },
		{ name: "kitchenPhotos", maxCount: 3 },
		{ name: "cacImage", maxCount: 1 },
	]),
	becomeCook,
);
router.get("/kyc-status", protect, getCookKYCStatus);
router.post("/referral", protect, referCook); // New referral route
router.post("/bank", protect, addCookBankAccount);
router.put("/bank", protect, updateCookBankAccount);
router.delete("/bank", protect, deleteCookBankAccount);

// Update cook profile
router.patch("/update", protect, updateCookProfile);

// Get single cook
router.get("/:id", getCookById);

// Get all cooks
router.get("/", getAllCooks);

export default router;
