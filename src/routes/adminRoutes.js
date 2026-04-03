import express from "express";
import {
	cancelOrder,
	getAllMainOrders,
	getAllOrders,
	getAtRiskOrders,
	getFulfillmentTime,
	getOrderAnalytics,
	getOrderById,
	getOrderChart,
	getOverviewStats,
	getSnapshot,
	getSystemAlerts,
	globalSearch,
	issueRefund,
} from "../controllers/adminController.js";
import {
	addCookNote,
	changeCookStatus,
	creditCookWallet,
	getAllCooks,
	getCookById,
	getCookStats,
	messageCook,
} from "../controllers/adminCooksController.js";
import {
	getPaymentById,
	getPayments,
	getPaymentStats,
	refundPayment,
} from "../controllers/adminPaymentController.js";
import {
	addCustomerNote,
	creditCustomerWallet,
	getCustomers,
	getCustomerById,
	messageCustomer,
	toggleCustomerStatus,
} from "../controllers/CustomerController.js";
import adminOnly from "../middleware/admin.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Become a cook
router.get("/stats/overview", protect, adminOnly, getOverviewStats);
router.get("/stats/orders-chart", protect, adminOnly, getOrderChart);
router.get("/stats/fulfilment", protect, adminOnly, getFulfillmentTime);
router.get("/system-alerts", protect, adminOnly, getSystemAlerts);
router.get("/orders", protect, adminOnly, getAllOrders);
router.get("/orders/analytics", protect, adminOnly, getOrderAnalytics);
router.get("/orders/filter", protect, adminOnly, getAllMainOrders);
router.get("/orders/at-risk", protect, adminOnly, getAtRiskOrders);
router.get("/customers", protect, adminOnly, protect, getCustomers);
// Cook stats
router.get("/cooks/stats", protect, adminOnly, getCookStats);

// Fetch all cooks with filters
router.get("/cooks", protect, adminOnly, getAllCooks);
router.get("/snapshot", protect, adminOnly, getSnapshot);
// Stats
router.get("/payments/stats", protect, adminOnly, getPaymentStats);

// List payments
router.get("/payments", protect, adminOnly, getPayments);
router.get("/search", protect, adminOnly, globalSearch);

// Single payment
router.get("/payments/:id", protect, adminOnly, getPaymentById);

// Refund
router.post("/payments/:id/refund", protect, adminOnly, refundPayment);

// Fetch
router.get("/cooks/:cookId", protect, adminOnly, getCookById);

// Message cook
router.post("/cooks/:cookId/message", protect, adminOnly, messageCook);
(adminOnly,
	// Add note to cook
	router.post("/cooks/:cookId/note", protect, adminOnly, addCookNote));

// Change cook status
router.post("/cooks/:cookId/status", protect, adminOnly, changeCookStatus);

// Credit cook wallet
router.post("/cooks/:cookId/credit", protect, adminOnly, creditCookWallet);
router.post("/customers/:userId/note", protect, adminOnly, addCustomerNote);
router.get("/customer/:userId", protect, adminOnly, getCustomerById);
router.post("/customers/:userId/message", protect, adminOnly, messageCustomer);
router.post(
	"/customers/:userId/credit",
	protect,
	adminOnly,
	creditCustomerWallet,
);
router.post(
	"/customers/:userId/status",
	protect,
	adminOnly,
	toggleCustomerStatus,
);

router.get("/orders/:id", protect, adminOnly, getOrderById);

router.patch("/orders/:id/cancel", protect, adminOnly, cancelOrder);
router.patch("/orders/:id/refund", protect, adminOnly, issueRefund);

export default router;
