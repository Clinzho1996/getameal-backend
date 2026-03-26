import express from "express";
import {
	adminLogin,
	adminRequestPasswordReset,
	adminResetPassword,
	createAdmin,
	loginInit,
	loginVerify,
	signupComplete,
	signupInit,
	signupVerify,
} from "../controllers/authController.js";

const router = express.Router();

// Signup Flow
router.post("/signup/init", signupInit); // send OTP
router.post("/signup/verify", signupVerify); // verify OTP
router.post("/signup/complete", signupComplete); // create account

router.post("/admin/create", createAdmin); // send OTP
router.post("/admin/login", adminLogin); // verify OTP
router.post("/admin/forgot-password", adminRequestPasswordReset);
router.post("/admin/reset-password", adminResetPassword);

// Login
router.post("/login/init", loginInit);
router.post("/login/verify", loginVerify);

export default router;
