import bcrypt from "bcryptjs";
import CookProfile from "../models/CookProfile.js";
import OTP from "../models/OTP.js";
import User from "../models/User.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { generateOTP } from "../utils/generateOtp.js";
import { generateToken } from "../utils/jwt.js";
import { verifyFirebaseToken } from "../config/firebase.js";

export const createAdmin = async (req, res) => {
	try {
		const { email, password, name } = req.body;

		const existing = await User.findOne({ email });

		if (existing) {
			return res.status(409).json({ message: "Admin already exists" });
		}

		const hashedPassword = await bcrypt.hash(password, 10);

		const admin = await User.create({
			fullName: name,
			email,
			password: hashedPassword,
			role: "admin",
			isVerified: true,
		});

		res.status(201).json({
			message: "Admin created",
			admin,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const adminLogin = async (req, res) => {
	try {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).json({
				message: "Email and password are required",
			});
		}

		const user = await User.findOne({ email }).select("+password");

		if (!user || user.role !== "admin") {
			return res.status(401).json({
				message: "Invalid credentials",
			});
		}

		const isMatch = await bcrypt.compare(password, user.password);

		if (!isMatch) {
			return res.status(401).json({
				message: "Invalid credentials",
			});
		}

		const token = generateToken(user._id);
		console.log("SIGN SECRET:", process.env.JWT_SECRET);

		res.status(200).json({
			message: "Admin login successful",
			token,
			user: {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				role: user.role,
			},
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

export const adminRequestPasswordReset = async (req, res) => {
	try {
		const { email } = req.body;

		const user = await User.findOne({ email });

		if (!user || user.role !== "admin") {
			return res.status(404).json({ message: "Admin not found" });
		}

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.status(200).json({
			message: "Reset OTP sent to admin email",
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const adminResetPassword = async (req, res) => {
	try {
		const { email, otp, newPassword } = req.body;

		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({ message: "Invalid OTP" });
		}

		if (record.expiresAt < Date.now()) {
			return res.status(400).json({ message: "OTP expired" });
		}

		const hashedPassword = await bcrypt.hash(newPassword, 10);

		await User.findOneAndUpdate(
			{ email, role: "admin" },
			{ password: hashedPassword },
		);

		res.status(200).json({
			message: "Password reset successful",
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
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

		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({ message: "Incorrect OTP" });
		}

		if (record.expiresAt < Date.now()) {
			return res.status(400).json({ message: "OTP expired" });
		}

		const user = await User.findOne({ email });

		const cookProfile = await CookProfile.findOne({
			userId: user._id,
		});

		const token = generateToken(user._id);

		res.status(200).json({
			message: "Login successful",
			token,
			user,
			isCook: !!cookProfile,
			cookProfile,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

export const socialAuth = async (req, res) => {
	try {
		const { idToken, name, email, appleUserId } = req.body;

		if (!idToken) {
			return res.status(400).json({
				success: false,
				message: "Token required",
			});
		}

		const decoded = await verifyFirebaseToken(idToken);
		const { uid, email: fbEmail, firebase } = decoded;

		const userEmail = email || fbEmail;
		const provider = firebase?.sign_in_provider || "google.com";

		// Try to find existing user by various methods
		let user = await User.findOne({ firebaseUid: uid });

		if (!user && appleUserId) {
			user = await User.findOne({ appleUserId });
		}

		if (!user && userEmail) {
			user = await User.findOne({ email: userEmail });
		}

		// If user exists, update their info and return
		if (user) {
			// Update any missing fields
			if (!user.firebaseUid && uid) user.firebaseUid = uid;
			if (!user.fullName && name) user.fullName = name;
			if (appleUserId && !user.appleUserId) user.appleUserId = appleUserId;
			if (!user.provider) user.provider = provider;

			await user.save();

			const token = generateToken(user._id);

			return res.status(200).json({
				success: true,
				token,
				user,
			});
		}

		// If no user exists, create a new one
		user = await User.create({
			fullName: name || userEmail.split("@")[0],
			email: userEmail,
			firebaseUid: uid,
			appleUserId: appleUserId || undefined,
			provider,
			isVerified: true,
		});

		const token = generateToken(user._id);

		return res.status(200).json({
			success: true,
			token,
			user,
		});
	} catch (error) {
		// Handle duplicate key error specifically
		if (error.code === 11000) {
			// Try to find and return the existing user
			try {
				const existingUser = await User.findOne({ email: req.body.email });
				if (existingUser) {
					const token = generateToken(existingUser._id);
					return res.status(200).json({
						success: true,
						token,
						user: existingUser,
						message: "Existing user logged in",
					});
				}
			} catch (findError) {
				console.error("Error finding existing user:", findError);
			}
		}

		return res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};
