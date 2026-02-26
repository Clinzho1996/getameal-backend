import express from "express";
import {
	becomeCook,
	getAllCooks,
	getCookById,
	updateCookProfile,
} from "../controllers/cookController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Become a cook
router.post("/become", protect, becomeCook);

// Update cook profile
router.patch("/update", protect, updateCookProfile);

// Get single cook
router.get("/:id", getCookById);

// Get all cooks
router.get("/", getAllCooks);

export default router;
