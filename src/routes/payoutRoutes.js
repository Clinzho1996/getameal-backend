// routes/payoutRoutes.js
import express from "express";
import { requestPayout } from "../controllers/payoutController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// POST /api/payouts/request
router.post("/request", protect, requestPayout);

export default router;
