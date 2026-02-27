import OTP from "../models/OTP.js";
import User from "../models/User.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { generateOTP } from "../utils/generateOtp.js";
import { generateToken } from "../utils/jwt.js";

// Step 1: Signup Init
export const signupInit = async (req, res) => {
	try {
		const { email } = req.body;

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		// Send Email
		await sendOTPEmail(email, code);

		res.json({
			message: "OTP sent to email",
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

// Step 2: Verify OTP
export const signupVerify = async (req, res) => {
	const { email, otp } = req.body;

	const record = await OTP.findOne({ email, code: otp });

	if (!record || record.expiresAt < Date.now())
		return res.status(400).json({ message: "Invalid OTP" });

	record.verified = true;
	await record.save();

	res.json({ verified: true });
};

// Step 3: Complete Signup
export const signupComplete = async (req, res) => {
	const { name, email, phone } = req.body;

	const otpRecord = await OTP.findOne({ email, verified: true });
	if (!otpRecord) return res.status(400).json({ message: "OTP not verified" });

	const user = await User.create({
		fullName: name,
		email,
		phone,
		isVerified: true,
	});

	const token = generateToken(user._id);

	res.json({ token, user });
};

// Step 1: Login Init
export const loginInit = async (req, res) => {
	try {
		const { email } = req.body;

		const user = await User.findOne({ email });

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.json({
			message: "OTP sent",
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

// Login using JWT
// Step 2: Login Verify
export const loginVerify = async (req, res) => {
	try {
		const { email, otp } = req.body;

		const record = await OTP.findOne({
			email,
			code: otp,
		});

		if (!record || record.expiresAt < Date.now()) {
			return res.status(400).json({
				message: "Invalid OTP",
			});
		}

		const user = await User.findOne({ email });

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		const token = generateToken(user._id);

		res.json({
			token,
			user,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};
