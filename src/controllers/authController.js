import bcrypt from "bcryptjs";
import { verifyFirebaseToken } from "../config/firebase.js";
import CookProfile from "../models/CookProfile.js";
import OTP from "../models/OTP.js";
import User from "../models/User.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { generateOTP } from "../utils/generateOtp.js";
import { generateToken } from "../utils/jwt.js";

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

		// Check if user account is suspended
		if (user.status === "suspended") {
			// Get the latest suspension note for better error message
			const suspensionNote = user.notes?.find((n) =>
				n.note?.toLowerCase().includes("suspended"),
			);

			return res.status(403).json({
				message:
					"Your account has been suspended. Please contact support for assistance.",
				error: "ACCOUNT_SUSPENDED",
				details: {
					reason: suspensionNote?.note || "Violation of terms of service",
					suspendedAt: user.updatedAt,
					supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
				},
			});
		}

		// Check if user account is inactive (optional)
		if (user.status === "inactive") {
			return res.status(403).json({
				message:
					"Your account is inactive. Please contact support to reactivate your account.",
				error: "ACCOUNT_INACTIVE",
			});
		}

		// Check if user is a cook and their cook profile is suspended
		if (user.isCook) {
			const cookProfile = await CookProfile.findOne({ userId: user._id });

			if (cookProfile && cookProfile.isSuspended) {
				return res.status(403).json({
					message:
						"Your cook account has been suspended. Please contact support for assistance.",
					error: "COOK_ACCOUNT_SUSPENDED",
					details: {
						reason: cookProfile.suspensionReason,
						suspendedAt: cookProfile.suspendedAt,
						supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
					},
				});
			}

			// Check if cook profile is not approved
			if (cookProfile && !cookProfile.isApproved) {
				return res.status(403).json({
					message:
						"Your cook account is pending approval. You will be notified once approved.",
					error: "COOK_NOT_APPROVED",
				});
			}
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
			user: {
				email: user.email,
				fullName: user.fullName,
				isCook: user.isCook,
				role: user.role,
				status: user.status,
			},
		});
	} catch (error) {
		console.error("Login init error:", error);
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

		// Validate input
		if (!email || !otp) {
			return res.status(400).json({
				message: "Email and OTP are required",
			});
		}

		// Find OTP record
		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({ message: "Invalid OTP code" });
		}

		// Check if OTP is expired
		if (record.expiresAt < Date.now()) {
			await OTP.deleteOne({ _id: record._id }); // Clean up expired OTP
			return res
				.status(400)
				.json({ message: "OTP has expired. Please request a new one." });
		}

		// Find user
		const user = await User.findOne({ email }).select("+password");

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// CHECK: User account suspension
		if (user.status === "suspended") {
			// Get suspension details from notes
			const suspensionNote = user.notes?.find((n) =>
				n.note?.toLowerCase().includes("suspended"),
			);

			return res.status(403).json({
				message: "Your account has been suspended. Please contact support.",
				error: "ACCOUNT_SUSPENDED",
				details: {
					reason: suspensionNote?.note || "Violation of terms of service",
					suspendedAt: user.updatedAt,
					supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
				},
			});
		}

		// CHECK: User account inactive
		if (user.status === "inactive") {
			return res.status(403).json({
				message:
					"Your account is inactive. Please contact support to reactivate your account.",
				error: "ACCOUNT_INACTIVE",
			});
		}

		// Get cook profile if exists
		let cookProfile = null;
		let isCook = false;
		let cookSuspensionStatus = null;

		if (user.isCook) {
			cookProfile = await CookProfile.findOne({ userId: user._id });
			isCook = !!cookProfile;

			// CHECK: Cook profile suspension
			if (cookProfile && cookProfile.isSuspended) {
				cookSuspensionStatus = {
					isSuspended: true,
					reason: cookProfile.suspensionReason,
					note: cookProfile.suspensionNote,
					suspendedAt: cookProfile.suspendedAt,
				};

				return res.status(403).json({
					message:
						"Your cook account has been suspended. Please contact support.",
					error: "COOK_ACCOUNT_SUSPENDED",
					details: cookSuspensionStatus,
				});
			}

			// CHECK: Cook profile approval status
			if (cookProfile && !cookProfile.isApproved) {
				return res.status(403).json({
					message:
						"Your cook account is pending approval. You will be notified once approved.",
					error: "COOK_NOT_APPROVED",
					details: {
						submittedAt: cookProfile.createdAt,
						status: "pending_approval",
					},
				});
			}
		}

		// Delete used OTP
		await OTP.deleteOne({ _id: record._id });

		// Generate token
		const token = generateToken(user._id);

		// Remove sensitive data
		const userData = {
			_id: user._id,
			email: user.email,
			fullName: user.fullName,
			phone: user.phone,
			role: user.role,
			isCook: user.isCook,
			profileImage: user.profileImage,
			coverImage: user.coverImage,
			location: user.location,
			status: user.status,
			isVerified: user.isVerified,
			notificationSettings: user.notificationSettings,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		};

		// Prepare cook profile data (if exists)
		let cookProfileData = null;
		if (cookProfile) {
			cookProfileData = {
				_id: cookProfile._id,
				cookDisplayName: cookProfile.cookDisplayName || cookProfile.cookName,
				firstName: cookProfile.firstName,
				lastName: cookProfile.lastName,
				bio: cookProfile.bio,
				profilePhoto: cookProfile.profilePhoto,
				coverPhoto: cookProfile.coverPhoto,
				kitchenPhotos: cookProfile.kitchenPhotos,
				cookAddress: cookProfile.cookAddress,
				location: cookProfile.location,
				cookingExperience: cookProfile.cookingExperience,
				isApproved: cookProfile.isApproved,
				isAvailable: cookProfile.isAvailable,
				isSuspended: cookProfile.isSuspended,
				rating: cookProfile.rating,
				ordersCount: cookProfile.ordersCount,
				walletBalance: cookProfile.walletBalance,
				kycInfo: cookProfile.kycInfo,
				businessDetails: cookProfile.businessDetails,
				bankDetails: cookProfile.bankDetails
					? {
							bankName: cookProfile.bankDetails.bankName,
							accountNumber: cookProfile.bankDetails.accountNumber
								? `****${cookProfile.bankDetails.accountNumber.slice(-4)}`
								: null,
							accountName: cookProfile.bankDetails.accountName,
						}
					: null,
			};
		}

		res.status(200).json({
			success: true,
			message: "Login successful",
			token,
			user: userData,
			isCook: isCook,
			cookProfile: cookProfileData,
			// Add suspension status for awareness
			accountStatus: {
				isSuspended: user.status === "suspended",
				status: user.status,
				isApproved: cookProfile ? cookProfile.isApproved : true,
				isCookSuspended: cookProfile ? cookProfile.isSuspended : false,
			},
		});
	} catch (error) {
		console.error("Login verify error:", error);
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

		// Validate email exists
		if (!userEmail) {
			return res.status(400).json({
				success: false,
				message: "Email is required for authentication",
			});
		}

		// Try to find existing user by various methods
		let user = await User.findOne({ firebaseUid: uid });

		if (!user && appleUserId) {
			user = await User.findOne({ appleUserId });
		}

		if (!user && userEmail) {
			user = await User.findOne({ email: userEmail });
		}

		// If user exists, check suspension status before proceeding
		if (user) {
			// CHECK: User account suspension
			if (user.status === "suspended") {
				const suspensionNote = user.notes?.find((n) =>
					n.note?.toLowerCase().includes("suspended"),
				);

				return res.status(403).json({
					success: false,
					message: "Your account has been suspended. Please contact support.",
					error: "ACCOUNT_SUSPENDED",
					details: {
						reason: suspensionNote?.note || "Violation of terms of service",
						suspendedAt: user.updatedAt,
						supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
					},
				});
			}

			// CHECK: User account inactive
			if (user.status === "inactive") {
				return res.status(403).json({
					success: false,
					message:
						"Your account is inactive. Please contact support to reactivate your account.",
					error: "ACCOUNT_INACTIVE",
				});
			}

			// Update any missing fields
			let needsUpdate = false;

			if (!user.firebaseUid && uid) {
				user.firebaseUid = uid;
				needsUpdate = true;
			}
			if (!user.fullName && name) {
				user.fullName = name;
				needsUpdate = true;
			}
			if (appleUserId && !user.appleUserId) {
				user.appleUserId = appleUserId;
				needsUpdate = true;
			}
			if (!user.provider) {
				user.provider = provider;
				needsUpdate = true;
			}

			// Update last login time
			user.lastLoginAt = new Date();
			needsUpdate = true;

			if (needsUpdate) {
				await user.save();
			}

			// Check cook profile suspension if user is a cook
			let cookProfile = null;
			let isCook = false;

			if (user.isCook) {
				cookProfile = await CookProfile.findOne({ userId: user._id });
				isCook = !!cookProfile;

				if (cookProfile && cookProfile.isSuspended) {
					return res.status(403).json({
						success: false,
						message:
							"Your cook account has been suspended. Please contact support.",
						error: "COOK_ACCOUNT_SUSPENDED",
						details: {
							reason: cookProfile.suspensionReason,
							note: cookProfile.suspensionNote,
							suspendedAt: cookProfile.suspendedAt,
							supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
						},
					});
				}
			}

			const token = generateToken(user._id);

			// Remove sensitive data
			const userData = {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				phone: user.phone,
				role: user.role,
				isCook: user.isCook,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
				status: user.status,
				isVerified: user.isVerified,
				provider: user.provider,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
			};

			return res.status(200).json({
				success: true,
				message: "Login successful",
				token,
				user: userData,
				isCook: isCook,
				cookProfile: cookProfile
					? {
							_id: cookProfile._id,
							cookDisplayName: cookProfile.cookDisplayName,
							isApproved: cookProfile.isApproved,
							isAvailable: cookProfile.isAvailable,
							isSuspended: cookProfile.isSuspended,
							rating: cookProfile.rating,
						}
					: null,
				accountStatus: {
					isSuspended: user.status === "suspended",
					status: user.status,
					isCookSuspended: cookProfile ? cookProfile.isSuspended : false,
				},
			});
		}

		// If no user exists, create a new one
		// Check if email is already taken by a suspended account (should have been found above, but double-check)
		const existingUserWithEmail = await User.findOne({ email: userEmail });
		if (existingUserWithEmail) {
			// This case should have been caught above, but just in case
			return res.status(409).json({
				success: false,
				message: "User already exists with this email. Please log in normally.",
				error: "USER_EXISTS",
			});
		}

		// Create new user
		user = await User.create({
			fullName: name || userEmail.split("@")[0],
			email: userEmail,
			firebaseUid: uid,
			appleUserId: appleUserId || undefined,
			provider,
			isVerified: true,
			status: "active", // Explicitly set status
			lastLoginAt: new Date(),
		});

		const token = generateToken(user._id);

		const userData = {
			_id: user._id,
			email: user.email,
			fullName: user.fullName,
			role: user.role,
			isCook: user.isCook,
			status: user.status,
			isVerified: user.isVerified,
			provider: user.provider,
			createdAt: user.createdAt,
		};

		return res.status(200).json({
			success: true,
			message: "Account created and logged in successfully",
			token,
			user: userData,
			isCook: false,
			cookProfile: null,
			accountStatus: {
				isSuspended: false,
				status: "active",
				isCookSuspended: false,
			},
		});
	} catch (error) {
		console.error("Social auth error:", error);

		// Handle duplicate key error specifically
		if (error.code === 11000) {
			try {
				// Try to find and return the existing user
				const existingUser = await User.findOne({ email: req.body.email });
				if (existingUser) {
					// Check suspension for existing user
					if (existingUser.status === "suspended") {
						return res.status(403).json({
							success: false,
							message:
								"Your account has been suspended. Please contact support.",
							error: "ACCOUNT_SUSPENDED",
						});
					}

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
			message: "Authentication failed. Please try again.",
			error: error.message,
		});
	}
};
