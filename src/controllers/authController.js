import OTP from "../models/OTP.js";
import User from "../models/User.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { generateOTP } from "../utils/generateOtp.js";
import { generateToken } from "../utils/jwt.js";

// STEP 1: Signup Init
export const signupInit = async (req, res) => {
	try {
		const { email } = req.body;

		if (!email) {
			return res.status(400).json({ message: "Email is required" });
		}

		const existingUser = await User.findOne({ email });

		if (existingUser) {
			return res.status(409).json({
				message: "Account already exists. Please login instead.",
			});
		}

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.status(200).json({
			message: "OTP sent to email",
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 2: Verify OTP
export const signupVerify = async (req, res) => {
	try {
		const { email, otp } = req.body;

		if (!email || !otp) {
			return res.status(400).json({
				message: "Email and OTP are required",
			});
		}

		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({
				message: "Incorrect OTP",
			});
		}

		if (record.expiresAt < Date.now()) {
			return res.status(400).json({
				message: "OTP has expired",
			});
		}

		record.verified = true;
		await record.save();

		res.status(200).json({
			message: "OTP verified successfully",
			verified: true,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 3: Complete Signup
export const signupComplete = async (req, res) => {
	try {
		const { name, email, phone } = req.body;

		if (!name || !email) {
			return res.status(400).json({
				message: "Name and email are required",
			});
		}

		const otpRecord = await OTP.findOne({
			email,
			verified: true,
		});

		if (!otpRecord) {
			return res.status(400).json({
				message: "OTP not verified. Please verify OTP first.",
			});
		}

		const existingUser = await User.findOne({ email });

		if (existingUser) {
			return res.status(409).json({
				message: "Account already exists",
			});
		}

		const user = await User.create({
			fullName: name,
			email,
			phone,
			isVerified: true,
		});

		const token = generateToken(user._id);

		res.status(201).json({
			message: "Account created successfully",
			token,
			user,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 1: Login Init
export const loginInit = async (req, res) => {
	try {
		const { email } = req.body;

		if (!email) {
			return res.status(400).json({
				message: "Email is required",
			});
		}

		const user = await User.findOne({ email });

		if (!user) {
			return res.status(404).json({
				message: "Account not found. Please register first.",
			});
		}

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.status(200).json({
			message: "OTP sent to your email",
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 2: Login Verify
export const loginVerify = async (req, res) => {
	try {
		const { email, otp } = req.body;

		if (!email || !otp) {
			return res.status(400).json({
				message: "Email and OTP are required",
			});
		}

		const record = await OTP.findOne({
			email,
			code: otp,
		});

		if (!record) {
			return res.status(400).json({
				message: "Incorrect OTP",
			});
		}

		if (record.expiresAt < Date.now()) {
			return res.status(400).json({
				message: "OTP expired",
			});
		}

		const user = await User.findOne({ email });

		if (!user) {
			return res.status(404).json({
				message: "User not registered",
			});
		}

		const token = generateToken(user._id);

		res.status(200).json({
			message: "Login successful",
			token,
			user,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};
