// routes/orderRoutes.js
import express from "express";
import {
	createOrder,
	getActiveOrders,
	getCompletedOrders,
	getCookOrderStats,
	getMyOrders,
	getNewOrders,
	getOrderById,
	getPastOrders,
	sendDeliveryOTP,
	updateOrder,
	updatePaymentStatus,
	verifyDeliveryOTP,
} from "../controllers/orderController.js";
import protect from "../middleware/auth.js"; // ✅ default import

const router = express.Router();

router.post("/", protect, createOrder);
router.get("/mine", protect, getMyOrders);
// Cook Orders
router.get("/new", protect, getNewOrders);
router.get("/active", protect, getActiveOrders);
router.get("/completed", protect, getCompletedOrders);
router.get("/past", protect, getPastOrders);
router.get("/stats", protect, getCookOrderStats);
router.get("/:id", protect, getOrderById);
router.put("/:id", protect, updateOrder);
router.post("/:id/send-otp", protect, sendDeliveryOTP);

router.post("/:id/verify-otp", protect, verifyDeliveryOTP);
router.patch("/:id/pay", protect, updatePaymentStatus);

export default router;
