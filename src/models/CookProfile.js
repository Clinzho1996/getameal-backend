import mongoose from "mongoose";

const cookSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		// Personal Information
		firstName: { type: String, required: true },
		lastName: { type: String, required: true },
		phone: { type: String, required: true },
		email: { type: String, required: true },
		cookDisplayName: { type: String, required: true },
		profilePhoto: { type: String }, // URL or path
		coverPhoto: { type: String }, // URL or path
		bio: { type: String, maxlength: 500 },

		// Payout Details
		bankDetails: {
			bankName: String,
			bankCode: String,
			accountNumber: String,
			accountName: String,
			recipientCode: String,
		},

		// Business Details
		businessDetails: {
			cac: {
				isRegistered: { type: Boolean, default: false },
				registrationNumber: String,
				certificateImage: String, // URL or path for CAC image
			},
			cookType: {
				type: String,
				enum: ["individual", "business", "registered_business"],
			},
		},

		// KYC Information
		kycInfo: {
			isRegistered: { type: Boolean, required: true }, // Are you registered with KYC?
			businessType: {
				type: String,
				enum: ["individual", "business"],
				required: function () {
					return !this.kycInfo?.isRegistered;
				},
			},
			cacImage: { type: String }, // CAC image if isRegistered is true
		},

		// Kitchen Information
		cookAddress: String,
		location: {
			type: { type: String, enum: ["Point"] },
			coordinates: [Number],
			address: String,
		},
		kitchenPhotos: [{ type: String }], // Array of 3 image URLs/paths

		// Existing fields
		cookingExperience: String,
		availableForCooking: Date,
		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		ordersCount: { type: Number, default: 0 },
		walletBalance: { type: Number, default: 0 },
		availablePickup: { type: Boolean, default: true },
		schedule: [String],
		isApproved: { type: Boolean, default: false },
		isAvailable: { type: Boolean, default: false },
		isSuspended: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

// Create geospatial index
cookSchema.index({ location: "2dsphere" });

export default mongoose.model("CookProfile", cookSchema);
