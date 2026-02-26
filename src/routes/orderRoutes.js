// routes/orderRoutes.js
import express from "express";
import {
	createOrder,
	getMyOrders,
	getOrderById,
	sendDeliveryOTP,
	updateOrder,
	updatePaymentStatus,
	verifyDeliveryOTP,
} from "../controllers/orderController.js";
import protect from "../middleware/auth.js"; // ✅ default import

const router = express.Router();

router.post("/", protect, createOrder);
router.get("/mine", protect, getMyOrders);
router.get("/:id", protect, getOrderById);
router.put("/:id", protect, updateOrder);
router.post("/:id/send-otp", protect, sendDeliveryOTP);

router.post("/:id/verify-otp", protect, verifyDeliveryOTP);
router.patch("/:id/pay", protect, updatePaymentStatus);

export default router;
