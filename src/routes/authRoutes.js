import express from "express";
import {
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

// Login
router.post("/login", loginVerify);

export default router;
