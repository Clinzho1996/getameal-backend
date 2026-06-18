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

export const getCookById = async (req, res) => {
	try {
		const { cookId } = req.params;

		const cook = await CookProfile.findById(cookId).populate(
			"userId",
			"fullName email phone profileImage isSuspended suspensionReason suspensionNote role",
		);

		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}

		const meals = await Meal.find({ cookId: cook.userId?._id || cook.userId })
			.select(
				"name description price images category status portionsRemaining portionsTotal createdAt cookingDate pickupWindow deliveryRegions quantityLabel unitsPerQuantity",
			)
			.sort({ createdAt: -1 })
			.populate("category", "name image");

		const formattedMeals = meals.map((meal) => ({
			_id: meal._id,
			name: meal.name,
			description: meal.description,
			category: meal.category,
			price: meal.price,
			images: meal.images || [],
			status: meal.status,
			portionsRemaining: meal.portionsRemaining,
			portionsTotal: meal.portionsTotal,
			quantityLabel: meal.quantityLabel,
			unitsPerQuantity: meal.unitsPerQuantity,
			cookingDate: meal.cookingDate,
			pickupWindow: meal.pickupWindow,
			deliveryRegions: meal.deliveryRegions,
			createdAt: meal.createdAt,
		}));

		const totalRevenue = await Order.aggregate([
			{
				$match: {
					cookId: cook.userId?._id || cook.userId,
					paymentStatus: "completed",
				},
			},
			{ $group: { _id: null, total: { $sum: "$totalAmount" } } },
		]);

		const recentOrders = await Order.find({
			cookId: cook.userId?._id || cook.userId,
		})
			.sort({ createdAt: -1 })
			.limit(10)
			.populate("userId", "fullName email phone")
			.select("orderNumber totalAmount status paymentStatus createdAt");

		const cookData = {
			cookId: cook._id,
			userId: cook.userId?._id,

			// Personal Information
			firstName: cook.firstName,
			lastName: cook.lastName,
			fullName: `${cook.firstName || ""} ${cook.lastName || ""}`.trim(),
			cookDisplayName: cook.cookDisplayName,
			email: cook.email,
			phone: cook.phone,
			bio: cook.bio,

			// Images
			profilePhoto: cook.profilePhoto,
			coverPhoto: cook.coverPhoto,
			kitchenPhotos: cook.kitchenPhotos,

			// Location Information
			location: cook.location,
			address: cook.cookAddress,
			coordinates: cook.location?.coordinates || null,

			// Professional Details
			experience: cook.cookingExperience,
			availablePickup: cook.availablePickup,
			schedule: cook.schedule,
			availableForCooking: cook.availableForCooking,

			// Status Flags - Use cook.isSuspended (directly from CookProfile)
			isAvailable: cook.isAvailable,
			isApproved: cook.isApproved,
			isSuspended: cook.isSuspended || false, // ✅ Fixed: use cook.isSuspended
			suspensionReason: cook.suspensionReason, // Add if you have this field
			suspensionNote: cook.suspensionNote, // Add if you have this field

			// KYC & Compliance
			kycInfo: {
				isRegistered: cook.kycInfo?.isRegistered || false,
				businessType: cook.kycInfo?.businessType,
				cacImage: cook.kycInfo?.cacImage,
				verifiedAt: cook.kycInfo?.verifiedAt,
			},
			businessDetails: {
				cac: cook.businessDetails?.cac,
				cookType: cook.businessDetails?.cookType,
				taxId: cook.businessDetails?.taxId,
				businessName: cook.businessDetails?.businessName,
			},

			// Payment Information
			bankDetails: cook.bankDetails,
			walletBalance: cook.walletBalance,

			// Performance Metrics
			rating: cook.rating,
			reviewsCount: cook.reviewsCount,
			ordersCount: cook.ordersCount,
			totalRevenue: totalRevenue[0]?.total || 0,

			// User Reference
			user: cook.userId
				? {
						id: cook.userId._id,
						fullName: cook.userId.fullName,
						email: cook.userId.email,
						phone: cook.userId.phone,
						profileImage: cook.userId.profileImage,
						role: cook.userId.role,
						isSuspended: cook.userId.isSuspended,
					}
				: null,

			createdAt: cook.createdAt,
			updatedAt: cook.updatedAt,
		};

		res.status(200).json({
			success: true,
			cook: cookData,
			meals: {
				list: formattedMeals,
				total: formattedMeals.length,
			},
			recentOrders: {
				list: recentOrders,
				total: recentOrders.length,
			},
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Get all cooks
export const getAllCooks = async (req, res) => {
	try {
		const {
			status,
			verification,
			city,
			sortBy,
			dateFrom,
			dateTo,
			isAvailable,
			kycStatus,
			suspensionStatus, // Add filter for suspended cooks
		} = req.query;

		const filter = {};

		if (status) {
			filter.isAvailable = status === "active";
		}

		if (verification) {
			filter.isApproved = verification === "verified";
		}

		// Filter by suspension status on CookProfile
		if (suspensionStatus === "suspended") {
			filter.isSuspended = true;
		} else if (suspensionStatus === "active") {
			filter.isSuspended = false;
		}

		if (kycStatus) {
			filter["kycInfo.isRegistered"] = kycStatus === "registered";
		}

		if (city) {
			filter["location.address"] = { $regex: city, $options: "i" };
		}

		if (typeof isAvailable !== "undefined") {
			filter.isAvailable = isAvailable === "true";
		}

		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo) filter.createdAt.$lte = new Date(dateTo);

		const sort = {};
		switch (sortBy) {
			case "newest":
				sort.createdAt = -1;
				break;
			case "oldest":
				sort.createdAt = 1;
				break;
			case "mostOrders":
				sort.ordersCount = -1;
				break;
			case "highestRating":
				sort.rating = -1;
				break;
			case "lastActive":
				sort.updatedAt = -1;
				break;
			default:
				sort.createdAt = -1;
		}

		const cooks = await CookProfile.find(filter)
			.sort(sort)
			.populate("userId", "fullName email phone profileImage isSuspended");

		const data = cooks.map((cook) => {
			let firstName = cook.firstName;
			let lastName = cook.lastName;
			let fullName = "";

			if (
				firstName &&
				firstName !== "Unknown" &&
				lastName &&
				lastName !== "Cook"
			) {
				fullName = `${firstName} ${lastName}`;
			} else if (cook.cookDisplayName && cook.cookDisplayName !== "undefined") {
				fullName = cook.cookDisplayName;
			} else if (cook.cookName) {
				fullName = cook.cookName;
			} else if (cook.userId?.fullName) {
				fullName = cook.userId.fullName;
			} else {
				fullName = "Chef";
			}

			const displayName =
				cook.cookDisplayName && cook.cookDisplayName !== "undefined"
					? cook.cookDisplayName
					: cook.cookName || fullName;

			let bio = cook.bio;
			if (!bio || bio.includes("undefined")) {
				bio = `${displayName} - Specializing in delicious home-cooked meals.`;
			}

			return {
				cookId: cook._id,
				userId: cook.userId?._id,
				firstName: firstName !== "Unknown" ? firstName : null,
				lastName: lastName !== "Cook" ? lastName : null,
				fullName: fullName,
				cookDisplayName: displayName,
				email:
					cook.email && cook.email !== "undefined"
						? cook.email
						: cook.userId?.email,
				phone:
					cook.phone && cook.phone !== "undefined"
						? cook.phone
						: cook.userId?.phone,
				bio: bio,
				profilePhoto:
					cook.profilePhoto ||
					cook.userId?.profileImage?.url ||
					cook.userId?.profileImage,
				coverPhoto: cook.coverPhoto,
				kitchenPhotos:
					cook.kitchenPhotos && cook.kitchenPhotos.length > 0
						? cook.kitchenPhotos
						: [],
				location: cook.location,
				address: cook.cookAddress,
				experience: cook.cookingExperience,
				isAvailable: cook.isAvailable,
				isApproved: cook.isApproved,
				isSuspended: cook.isSuspended || false, // ✅ Fixed: use cook.isSuspended
				availableForCooking: cook.availableForCooking,
				schedule: cook.schedule || [],
				kycInfo: cook.kycInfo || {
					isRegistered: false,
					businessType: "individual",
				},
				businessDetails: cook.businessDetails || {
					cac: { isRegistered: false },
					cookType: "individual",
				},
				bankDetails: cook.bankDetails || null,
				rating: cook.rating || 0,
				reviewsCount: cook.reviewsCount || 0,
				ordersCount: cook.ordersCount || 0,
				walletBalance: cook.walletBalance || 0,
				createdAt: cook.createdAt,
				updatedAt: cook.updatedAt,
				user: cook.userId
					? {
							id: cook.userId._id,
							fullName: cook.userId.fullName,
							email: cook.userId.email,
							phone: cook.userId.phone,
							profileImage: cook.userId.profileImage,
							isSuspended: cook.userId.isSuspended,
						}
					: null,
			};
		});

		res.status(200).json({
			success: true,
			count: data.length,
			cooks: data,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
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
			state,
			region,
			startImmediately,
			availableDate,
			referralCode,
			bankDetails,
			experience,
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

		// Check if files exist
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

		// Determine region based on state or coordinates
		const determineRegion = (state, lat, lng) => {
			if (region) return region;

			// If state is provided, map to region
			if (state) {
				const stateLower = state.toLowerCase();
				const mainlandStates = [
					"lagos mainland",
					"ikeja",
					"yaba",
					"surulere",
					"mushin",
					"agege",
					"alimosho",
					"egbeda",
					"akoka",
					"oshodi",
				];
				const islandStates = [
					"lagos island",
					"victoria island",
					"ikoyi",
					"lekki",
					"ajah",
					"epe",
					"badagry",
					"sangotedo",
				];

				if (mainlandStates.some((s) => stateLower.includes(s))) {
					return "Mainland";
				} else if (islandStates.some((s) => stateLower.includes(s))) {
					return "Island";
				}
			}

			// If coordinates are provided, use them to determine region
			if (lat && lng) {
				// Lagos Mainland approximate coordinates: 6.52°N, 3.37°E
				// Lagos Island approximate coordinates: 6.45°N, 3.43°E
				if (parseFloat(lat) > 6.5) {
					return "Mainland";
				} else {
					return "Island";
				}
			}

			return "Other";
		};

		const determinedRegion = determineRegion(state, latitude, longitude);

		// Create cook profile data
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
			cookingExperience: experience || "",
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
				submittedAt: new Date(),
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
			location: {
				type: "Point",
				coordinates:
					latitude && longitude
						? [parseFloat(longitude), parseFloat(latitude)]
						: [0, 0],
				address: address || "",
				state: state || "",
				region: determinedRegion,
			},
			availableForCooking:
				startImmediately === "true" || startImmediately === true
					? new Date()
					: availableDate
						? new Date(availableDate)
						: null,
		};

		// Add bank details if provided during onboarding
		let bankDetailsAdded = null;
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

				bankDetailsAdded = {
					bankName: parsedBankDetails.bankName,
					bankCode: parsedBankDetails.bankCode,
					accountNumber: `****${parsedBankDetails.accountNumber.slice(-4)}`,
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

		// Prepare response with complete data including bank details
		const responseData = {
			message:
				"Cook application submitted successfully. Awaiting admin approval.",
			status: "pending_approval",
			cookProfile: {
				id: cookProfile._id,
				userId: cookProfile.userId,
				firstName: cookProfile.firstName,
				lastName: cookProfile.lastName,
				fullName: `${cookProfile.firstName} ${cookProfile.lastName}`,
				cookDisplayName: cookProfile.cookDisplayName,
				email: cookProfile.email,
				phone: cookProfile.phone,
				bio: cookProfile.bio,
				profilePhoto: cookProfile.profilePhoto,
				coverPhoto: cookProfile.coverPhoto,
				kitchenPhotos: cookProfile.kitchenPhotos,
				address: cookProfile.cookAddress,
				location: cookProfile.location,
				experience: cookProfile.cookingExperience,
				isApproved: cookProfile.isApproved,
				isAvailable: cookProfile.isAvailable,
				kycInfo: {
					isRegistered: cookProfile.kycInfo?.isRegistered || false,
					businessType: cookProfile.kycInfo?.businessType || null,
					status: cookProfile.kycInfo?.isRegistered ? "registered" : "pending",
				},
				businessDetails: cookProfile.businessDetails,
				bankDetails: bankDetailsAdded,
				kycStatus: cookProfile.kycInfo?.isRegistered ? "registered" : "pending",
				createdAt: cookProfile.createdAt,
			},
			userLocation: cookProfile.location || null,
		};

		// Add bank details to response if they exist
		if (bankDetailsAdded) {
			responseData.bankDetailsAdded = true;
			responseData.message =
				"Cook application submitted successfully with bank details. Awaiting admin approval.";
		}

		res.status(201).json(responseData);
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
		const userId = req.user.id;
		const updates = req.body;

		// Find user and cook profile
		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		let cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// Fields that go to User model
		const userFields = [
			"fullName",
			"phone",
			"bio",
			"profileImage",
			"coverImage",
			"location",
		];

		// Fields that go to CookProfile model
		const cookFields = [
			"firstName",
			"lastName",
			"phone",
			"email",
			"cookDisplayName",
			"profilePhoto",
			"coverPhoto",
			"bio",
			"bankDetails",
			"businessDetails",
			"kycInfo",
			"cookAddress",
			"location",
			"kitchenPhotos",
			"availableForCooking",
			"availablePickup",
			"schedule",
			"isAvailable",
		];

		// Update User model
		userFields.forEach((field) => {
			if (updates[field] !== undefined) {
				user[field] = updates[field];
			}
		});

		// Also update individual name fields if provided
		if (updates.firstName) user.firstName = updates.firstName;
		if (updates.lastName) user.lastName = updates.lastName;
		if (updates.firstName && updates.lastName) {
			user.fullName = `${updates.firstName} ${updates.lastName}`;
		}
		if (updates.email) user.email = updates.email;
		if (updates.phone) user.phone = updates.phone;
		if (updates.bio) user.bio = updates.bio;

		// Update CookProfile model
		cookFields.forEach((field) => {
			if (updates[field] !== undefined) {
				cookProfile[field] = updates[field];
			}
		});

		// Handle location separately (GeoJSON format)
		if (updates.location) {
			if (typeof updates.location === "object") {
				cookProfile.location = updates.location;
				user.location = updates.location;
			} else if (updates.latitude && updates.longitude) {
				const locationObj = {
					type: "Point",
					coordinates: [
						parseFloat(updates.longitude),
						parseFloat(updates.latitude),
					],
					address: updates.address || cookProfile.cookAddress,
				};
				cookProfile.location = locationObj;
				user.location = locationObj;
			}
		}

		// Handle address separately
		if (updates.address) {
			cookProfile.cookAddress = updates.address;
			if (cookProfile.location) {
				cookProfile.location.address = updates.address;
			}
		}

		// Handle kitchen photos (array)
		if (updates.kitchenPhotos && Array.isArray(updates.kitchenPhotos)) {
			cookProfile.kitchenPhotos = updates.kitchenPhotos;
		}

		// Save both models
		await user.save();
		await cookProfile.save();

		// Return updated profile
		const updatedCookProfile = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		res.json({
			success: true,
			message: "Cook profile updated successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				phone: user.phone,
				bio: user.bio,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
				location: user.location,
			},
			cookProfile: updatedCookProfile,
		});
	} catch (error) {
		console.error("Error updating cook profile:", error);
		res.status(500).json({ message: error.message });
	}
};

export const updateCookProfileWithImages = async (req, res) => {
	try {
		const userId = req.user.id;
		const updates = req.body;

		// Find user and cook profile
		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		let cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// Handle file uploads if any
		const files = req.files || {};

		// Upload new profile photo if provided
		if (files.profilePhoto && files.profilePhoto[0]) {
			const result = await cloudinary.v2.uploader.upload(
				files.profilePhoto[0].path,
				{
					folder: "getameal/cooks/profiles",
					transformation: [{ width: 500, height: 500, crop: "fill" }],
				},
			);
			updates.profilePhoto = result.secure_url;
			updates.profileImage = result.secure_url;
			if (fs.existsSync(files.profilePhoto[0].path)) {
				fs.unlinkSync(files.profilePhoto[0].path);
			}
		}

		// Upload new cover photo if provided
		if (files.coverPhoto && files.coverPhoto[0]) {
			const result = await cloudinary.v2.uploader.upload(
				files.coverPhoto[0].path,
				{
					folder: "getameal/cooks/covers",
					transformation: [{ width: 1200, height: 400, crop: "fill" }],
				},
			);
			updates.coverPhoto = result.secure_url;
			updates.coverImage = result.secure_url;
			if (fs.existsSync(files.coverPhoto[0].path)) {
				fs.unlinkSync(files.coverPhoto[0].path);
			}
		}

		// Upload new kitchen photos if provided
		if (files.kitchenPhotos && files.kitchenPhotos.length > 0) {
			const kitchenPhotoUrls = [];
			for (const file of files.kitchenPhotos) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/cooks/kitchens",
					transformation: [{ width: 800, height: 600, crop: "fill" }],
				});
				kitchenPhotoUrls.push(result.secure_url);
				if (fs.existsSync(file.path)) {
					fs.unlinkSync(file.path);
				}
			}
			updates.kitchenPhotos = kitchenPhotoUrls;
		}

		// Fields that go to User model
		const userFields = [
			"fullName",
			"phone",
			"bio",
			"profileImage",
			"coverImage",
			"location",
		];

		// Fields that go to CookProfile model
		const cookFields = [
			"firstName",
			"lastName",
			"phone",
			"email",
			"cookDisplayName",
			"profilePhoto",
			"coverPhoto",
			"bio",
			"bankDetails",
			"businessDetails",
			"kycInfo",
			"cookAddress",
			"location",
			"kitchenPhotos",
			"availableForCooking",
			"availablePickup",
			"schedule",
			"isAvailable",
		];

		// Update User model
		userFields.forEach((field) => {
			if (updates[field] !== undefined) {
				user[field] = updates[field];
			}
		});

		if (updates.firstName) user.firstName = updates.firstName;
		if (updates.lastName) user.lastName = updates.lastName;
		if (updates.firstName && updates.lastName) {
			user.fullName = `${updates.firstName} ${updates.lastName}`;
		}
		if (updates.email) user.email = updates.email;
		if (updates.phone) user.phone = updates.phone;

		// Update CookProfile model
		cookFields.forEach((field) => {
			if (updates[field] !== undefined) {
				cookProfile[field] = updates[field];
			}
		});

		// Handle location
		if (updates.location) {
			if (typeof updates.location === "object") {
				cookProfile.location = updates.location;
				user.location = updates.location;
			} else if (updates.latitude && updates.longitude) {
				const locationObj = {
					type: "Point",
					coordinates: [
						parseFloat(updates.longitude),
						parseFloat(updates.latitude),
					],
					address: updates.address || cookProfile.cookAddress,
				};
				cookProfile.location = locationObj;
				user.location = locationObj;
			}
		}

		if (updates.address) {
			cookProfile.cookAddress = updates.address;
			if (cookProfile.location) {
				cookProfile.location.address = updates.address;
			}
		}

		// Save both models
		await user.save();
		await cookProfile.save();

		const updatedCookProfile = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		res.json({
			success: true,
			message: "Cook profile updated successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				phone: user.phone,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
			},
			cookProfile: updatedCookProfile,
		});
	} catch (error) {
		console.error("Error updating cook profile:", error);
		// Clean up uploaded files if error occurs
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
