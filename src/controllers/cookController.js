// controllers/cookController.js
import cloudinary from "cloudinary";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";
import { createAdminNotification } from "../utils/adminNotification.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// Get single cook by ID
// Get single cook by ID
export const getCookById = async (req, res) => {
	try {
		const cook = await User.findOne({
			_id: req.params.id,
			$or: [{ role: "cook" }, { isCook: true }],
		});

		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}

		const cookProfile = await CookProfile.findOne({
			userId: cook._id,
		});

		const { payoutBank, ...userData } = cook.toObject();
		res.json({
			...userData,
			cookProfile,
			bankDetails: cookProfile?.bankDetails || null,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all cooks
export const getAllCooks = async (req, res) => {
	try {
		const cooks = await User.find({
			$or: [{ role: "cook" }, { isCook: true }],
		}).select("_id fullName profileImage cookAddress  availableForCooking");

		const cookIds = cooks.map((c) => c._id);

		const cookProfiles = await CookProfile.find({
			userId: { $in: cookIds },
		});

		const merged = cooks.map((cook) => {
			const profile = cookProfiles.find(
				(p) => p.userId.toString() === cook._id.toString(),
			);

			return {
				...cook.toObject(),
				rating: profile?.rating || 0,
				ordersCount: profile?.ordersCount || 0,
				bankDetails: profile?.bankDetails || null,
				isApproved: profile?.isApproved || false,
			};
		});

		res.json(merged);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const referCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId);

		if (!user) return res.status(404).json({ message: "User not found" });

		// If user already has a referral code, return it
		if (!user.referralCode) {
			user.referralCode =
				"REF-" + crypto.randomBytes(3).toString("hex").toUpperCase();
			await user.save();
		}

		res.json({
			message: "Referral code generated",
			referralCode: user.referralCode,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
// Become a cook with file uploads
export const becomeCook = async (req, res) => {
	try {
		// Extract form-data fields
		const {
			firstName,
			lastName,
			phone,
			email,
			cookDisplayName,
			bio,
			kycInfo,
			businessDetails,
			address,
			latitude,
			longitude,
			startImmediately,
			availableDate,
			referralCode,
			bankDetails,
		} = req.body;

		const userId = req.user.id;

		// Check if files exist and are accessible
		console.log("Files received:", req.files);
		console.log("Body received:", req.body);

		// Parse JSON strings if they come as strings
		let parsedKycInfo = kycInfo;
		let parsedBusinessDetails = businessDetails;
		let parsedBankDetails = bankDetails;

		try {
			if (typeof kycInfo === "string") {
				parsedKycInfo = JSON.parse(kycInfo);
			}
			if (typeof businessDetails === "string") {
				parsedBusinessDetails = JSON.parse(businessDetails);
			}
			if (typeof bankDetails === "string") {
				parsedBankDetails = JSON.parse(bankDetails);
			}
		} catch (parseError) {
			return res.status(400).json({
				message:
					"Invalid JSON format in kycInfo, businessDetails, or bankDetails",
				error: parseError.message,
			});
		}

		// Validation
		const requiredFields = [
			"firstName",
			"lastName",
			"phone",
			"email",
			"cookDisplayName",
			"address",
		];

		const missingFields = requiredFields.filter((field) => !req.body[field]);
		if (missingFields.length > 0) {
			return res.status(400).json({
				message: `Missing required fields: ${missingFields.join(", ")}`,
			});
		}

		// Validate KYC info
		if (!parsedKycInfo || parsedKycInfo.isRegistered === undefined) {
			return res.status(400).json({
				message: "KYC registration information is required",
			});
		}

		// If not registered with KYC, business type is required
		if (!parsedKycInfo.isRegistered && !parsedKycInfo.businessType) {
			return res.status(400).json({
				message: "Business type is required when not registered with KYC",
			});
		}

		// Check if files exist - handle both req.files (for multiple fields) and req.file (for single)
		const files = req.files || {};

		// Extract files based on multer configuration
		const profilePhotoFile = files.profilePhoto ? files.profilePhoto[0] : null;
		const coverPhotoFile = files.coverPhoto ? files.coverPhoto[0] : null;
		const kitchenPhotoFiles = files.kitchenPhotos || [];
		const cacImageFile = files.cacImage ? files.cacImage[0] : null;

		// Validate required images
		if (!profilePhotoFile) {
			return res.status(400).json({ message: "Profile photo is required" });
		}
		if (!coverPhotoFile) {
			return res.status(400).json({ message: "Cover photo is required" });
		}
		if (!kitchenPhotoFiles || kitchenPhotoFiles.length !== 3) {
			return res.status(400).json({
				message: "Exactly 3 kitchen photos are required",
				received: kitchenPhotoFiles ? kitchenPhotoFiles.length : 0,
			});
		}

		// If registered with KYC, CAC image is required
		if (parsedKycInfo.isRegistered && !cacImageFile) {
			return res.status(400).json({
				message: "CAC image is required when registered with KYC",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// Check if already applied
		const existingCook = await CookProfile.findOne({ userId });
		if (existingCook) {
			return res.status(400).json({
				message: "You have already applied to become a cook",
			});
		}

		// Validate referral code if provided
		let referrer = null;
		// if (referralCode) {
		// 	referrer = await User.findOne({ referralCode });
		// 	if (!referrer) {
		// 		return res.status(400).json({
		// 			message: "Invalid referral code",
		// 		});
		// 	}
		// }

		// Upload images to Cloudinary
		let profilePhotoUrl = null;
		let coverPhotoUrl = null;
		let kitchenPhotoUrls = [];
		let cacImageUrl = null;

		try {
			// Upload profile photo
			if (profilePhotoFile && profilePhotoFile.path) {
				const result = await cloudinary.v2.uploader.upload(
					profilePhotoFile.path,
					{
						folder: "getameal/cooks/profiles",
						transformation: [{ width: 500, height: 500, crop: "fill" }],
					},
				);
				profilePhotoUrl = result.secure_url;
				if (fs.existsSync(profilePhotoFile.path)) {
					fs.unlinkSync(profilePhotoFile.path);
				}
			}

			// Upload cover photo
			if (coverPhotoFile && coverPhotoFile.path) {
				const result = await cloudinary.v2.uploader.upload(
					coverPhotoFile.path,
					{
						folder: "getameal/cooks/covers",
						transformation: [{ width: 1200, height: 400, crop: "fill" }],
					},
				);
				coverPhotoUrl = result.secure_url;
				if (fs.existsSync(coverPhotoFile.path)) {
					fs.unlinkSync(coverPhotoFile.path);
				}
			}

			// Upload kitchen photos
			for (const file of kitchenPhotoFiles) {
				if (file && file.path) {
					const result = await cloudinary.v2.uploader.upload(file.path, {
						folder: "getameal/cooks/kitchens",
						transformation: [{ width: 800, height: 600, crop: "fill" }],
					});
					kitchenPhotoUrls.push(result.secure_url);
					if (fs.existsSync(file.path)) {
						fs.unlinkSync(file.path);
					}
				}
			}

			// Upload CAC image if provided
			if (cacImageFile && cacImageFile.path) {
				const result = await cloudinary.v2.uploader.upload(cacImageFile.path, {
					folder: "getameal/cooks/cac",
				});
				cacImageUrl = result.secure_url;
				if (fs.existsSync(cacImageFile.path)) {
					fs.unlinkSync(cacImageFile.path);
				}
			}
		} catch (uploadError) {
			console.error("Image upload error:", uploadError);
			return res.status(500).json({
				message: "Failed to upload images",
				error: uploadError.message,
			});
		}

		// Create cook profile
		const cookProfileData = {
			userId,
			firstName,
			lastName,
			phone,
			email,
			cookDisplayName,
			profilePhoto: profilePhotoUrl,
			coverPhoto: coverPhotoUrl,
			bio: bio || "",
			cookAddress: address,
			availablePickup: true,
			schedule:
				startImmediately === "true" || startImmediately === true
					? ["Immediate"]
					: availableDate
						? [availableDate]
						: [],
			isApproved: false,
			isAvailable: true,
			kycInfo: {
				isRegistered: parsedKycInfo.isRegistered,
				businessType: parsedKycInfo.businessType || null,
				cacImage: cacImageUrl,
			},
			businessDetails: parsedBusinessDetails || {
				cac: {
					isRegistered: parsedKycInfo.isRegistered,
					registrationNumber: null,
					certificateImage: null,
				},
				cookType: parsedKycInfo.isRegistered
					? "registered_business"
					: parsedKycInfo.businessType || "individual",
			},
			kitchenPhotos: kitchenPhotoUrls,
			location:
				latitude && longitude
					? {
							type: "Point",
							coordinates: [parseFloat(longitude), parseFloat(latitude)],
							address: address,
						}
					: undefined,
			availableForCooking:
				startImmediately === "true" || startImmediately === true
					? new Date()
					: availableDate
						? new Date(availableDate)
						: null,
		};

		// Add bank details if provided during onboarding
		if (
			parsedBankDetails &&
			parsedBankDetails.accountNumber &&
			parsedBankDetails.bankCode
		) {
			try {
				// Verify bank account with Paystack
				const response = await axios.get(
					`https://api.paystack.co/bank/resolve?account_number=${parsedBankDetails.accountNumber}&bank_code=${parsedBankDetails.bankCode}`,
					{
						headers: {
							Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						},
					},
				);

				const { account_name } = response.data.data;

				cookProfileData.bankDetails = {
					accountNumber: parsedBankDetails.accountNumber,
					bankCode: parsedBankDetails.bankCode,
					bankName: parsedBankDetails.bankName,
					accountName: account_name,
				};
			} catch (error) {
				console.error("Bank account verification failed:", error.message);
				// Don't fail the entire onboarding, just log the error
			}
		}

		const cookProfile = await CookProfile.create(cookProfileData);

		// Update user information
		user.firstName = firstName;
		user.lastName = lastName;
		user.phone = phone;
		user.email = email;
		user.fullName = `${firstName} ${lastName}`;
		user.isCook = true;

		if (profilePhotoUrl) user.profileImage = profilePhotoUrl;

		await user.save();

		// Handle referral reward if applicable
		if (referrer) {
			// Add referral reward logic here
			console.log(`User ${userId} was referred by ${referrer._id}`);
		}

		// Create admin notification for new cook application
		await createAdminNotification({
			title: "New Cook Application",
			body: `${firstName} ${lastName} has applied to become a cook`,
			type: "cook_application",
			data: {
				cookId: cookProfile._id,
				userId: user._id,
			},
		});

		res.status(201).json({
			message:
				"Cook application submitted successfully. Awaiting admin approval.",
			status: "pending_approval",
			cookProfile: {
				id: cookProfile._id,
				cookDisplayName: cookProfile.cookDisplayName,
				isApproved: cookProfile.isApproved,
				kycStatus: cookProfile.kycInfo.isRegistered ? "registered" : "pending",
				profilePhoto: cookProfile.profilePhoto,
				coverPhoto: cookProfile.coverPhoto,
				kitchenPhotos: cookProfile.kitchenPhotos,
			},
			userLocation: cookProfile.location || null,
		});
	} catch (error) {
		console.error("Failed to submit cook application:", error);
		// Clean up any uploaded files if there was an error
		if (req.files) {
			for (const field in req.files) {
				if (Array.isArray(req.files[field])) {
					for (const file of req.files[field]) {
						if (file && file.path && fs.existsSync(file.path)) {
							fs.unlinkSync(file.path);
						}
					}
				}
			}
		}
		res.status(500).json({
			message: "Failed to submit cook application",
			error: error.message,
		});
	}
};

// Get cook KYC status
export const getCookKYCStatus = async (req, res) => {
	try {
		const userId = req.user.id;
		let cookProfile = await CookProfile.findOne({ userId });

		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		let needsUpdate = false;
		const updates = {};

		// FIX 1: If cook is approved but KYC not verified
		if (
			cookProfile.isApproved &&
			(!cookProfile.kycInfo?.verifiedAt ||
				cookProfile.kycInfo?.status !== "verified")
		) {
			updates["kycInfo.verifiedAt"] = new Date();
			updates["kycInfo.status"] = "verified";
			updates["kycInfo.submittedAt"] =
				cookProfile.kycInfo?.submittedAt || cookProfile.createdAt;
			needsUpdate = true;
			console.log(`Will fix KYC status for approved cook ${cookProfile._id}`);
		}

		// FIX 2: If CAC image exists but isRegistered is false
		if (cookProfile.kycInfo?.cacImage && !cookProfile.kycInfo?.isRegistered) {
			updates["kycInfo.isRegistered"] = true;
			updates["kycInfo.businessType"] = "business";
			updates["businessDetails.cac.isRegistered"] = true;
			updates["businessDetails.cookType"] = "registered_business";
			needsUpdate = true;
			console.log(`Will fix registration status for cook ${cookProfile._id}`);
		}

		// Apply fixes if needed
		if (needsUpdate) {
			await CookProfile.updateOne({ _id: cookProfile._id }, { $set: updates });
			// Refresh the profile
			cookProfile = await CookProfile.findOne({ userId });
			console.log(`Applied KYC fixes for cook ${cookProfile._id}`);
		}

		// Ensure kycInfo exists
		const kycInfo = cookProfile.kycInfo || {
			isRegistered: false,
			businessType: "individual",
			cacImage: null,
			submittedAt: null,
			verifiedAt: null,
			status: "pending",
		};

		// Ensure businessDetails exists
		const businessDetails = cookProfile.businessDetails || {
			cac: {
				isRegistered: kycInfo.isRegistered || false,
				registrationNumber: null,
				certificateImage: null,
			},
			cookType: kycInfo.isRegistered
				? "registered_business"
				: kycInfo.businessType || "individual",
			businessName: null,
			taxId: null,
		};

		// Calculate KYC completion status
		const isKycComplete = () => {
			if (kycInfo.isRegistered) {
				return !!kycInfo.cacImage;
			} else {
				return !!kycInfo.businessType;
			}
		};

		// Determine KYC verification status - PRIORITIZE verifiedAt
		let kycVerificationStatus = "pending";
		if (kycInfo.verifiedAt) {
			kycVerificationStatus = "verified";
		} else if (kycInfo.rejectedAt) {
			kycVerificationStatus = "rejected";
		} else if (kycInfo.submittedAt) {
			kycVerificationStatus = "submitted";
		}

		// If approved but status shows pending, override to verified
		if (cookProfile.isApproved && kycVerificationStatus === "pending") {
			kycVerificationStatus = "verified";
		}

		res.json({
			success: true,
			kycInfo: {
				isRegistered: kycInfo.isRegistered || false,
				businessType: kycInfo.businessType || "individual",
				cacImage: kycInfo.cacImage || null,
				submittedAt: kycInfo.submittedAt || null,
				verifiedAt:
					kycInfo.verifiedAt || (cookProfile.isApproved ? new Date() : null),
				status: kycVerificationStatus,
			},
			businessDetails: {
				cac: {
					isRegistered: businessDetails.cac?.isRegistered || false,
					registrationNumber: businessDetails.cac?.registrationNumber || null,
					certificateImage: businessDetails.cac?.certificateImage || null,
				},
				cookType: businessDetails.cookType || "individual",
				businessName: businessDetails.businessName || null,
				taxId: businessDetails.taxId || null,
			},
			isApproved: cookProfile.isApproved || false,
			requiresAdditionalDocs:
				!kycInfo.isRegistered && kycInfo.businessType === "business",
			isKycComplete: isKycComplete(),
			kycStatus: kycVerificationStatus,
		});
	} catch (error) {
		console.error("Error fetching KYC status:", error);
		res.status(500).json({ message: error.message });
	}
};

// Update cook profile
export const updateCookProfile = async (req, res) => {
	try {
		const updates = req.body;

		const user = await User.findById(req.user.id);
		if (!user) return res.status(404).json({ message: "User not found" });

		Object.keys(updates).forEach((key) => {
			user[key] = updates[key];
		});

		await user.save();

		res.json({ message: "Cook profile updated", user });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const addFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(cookId)) {
			return res.status(400).json({ message: "Invalid cook ID" });
		}

		// 1. Verify the target user exists and is actually a cook
		const cookExists = await User.exists({ _id: cookId, isCook: true });
		if (!cookExists) {
			return res.status(404).json({ message: "Cook not found" });
		}

		// 2. Add to savedCooks (using $addToSet to prevent duplicates)
		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $addToSet: { savedCooks: cookId } }, // Targeting the correct field
			{ returnDocument: "after" },
		).select("savedCooks");

		res.json({
			message: "Cook saved to your list",
			savedCooks: updatedUser.savedCooks,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to save cook", error: error.message });
	}
};
// Get all favorite cooks
export const getFavoriteCooks = async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId).select("savedCooks");

		if (!user || !user.savedCooks || user.savedCooks.length === 0) {
			return res.json([]);
		}

		// Pass savedCooks to your helper
		const favoriteCooks = await getFavoriteCooksHelper(user.savedCooks);
		res.json(favoriteCooks);
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to fetch saved cooks", error: error.message });
	}
};

// Remove a cook from favorites
export const removeFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $pull: { savedCooks: cookId } }, // Targeting the correct field
			{ returnDocument: "after" },
		).select("savedCooks");

		const favoriteCooks = await getFavoriteCooksHelper(updatedUser.savedCooks);

		res.json({
			message: "Cook removed from saved list",
			savedCooks: favoriteCooks,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to remove cook", error: error.message });
	}
};

const getFavoriteCooksHelper = async (favoriteIds) => {
	if (!favoriteIds || favoriteIds.length === 0) return [];

	// Convert all strings to ObjectIds safely
	const ids = favoriteIds.map((id) => new mongoose.Types.ObjectId(id));

	// Find the Users
	const favoriteUsers = await User.find({
		_id: { $in: ids },
		isCook: true,
	})
		.select("_id fullName profileImage isCook")
		.lean();

	// Find the corresponding Cook Profiles
	const cookProfiles = await CookProfile.find({
		userId: { $in: ids },
	}).lean();

	// Merge them
	return favoriteUsers.map((user) => {
		const profile = cookProfiles.find(
			(p) => p.userId.toString() === user._id.toString(),
		);
		return {
			...user,
			cookProfile: profile || null,
		};
	});
};
