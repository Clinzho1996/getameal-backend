// routes/payoutRoutes.js
import express from "express";
import {
	requestPayout,
	verifyPayoutOTP,
} from "../controllers/payoutController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// POST /api/payouts/request
router.post("/request", protect, requestPayout);
// POST /api/payouts/verify-otp
router.post("/verify-otp", protect, verifyPayoutOTP);

export default router;
