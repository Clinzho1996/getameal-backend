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
		profilePhoto: { type: String },
		coverPhoto: { type: String },
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
				certificateImage: String,
			},
			cookType: {
				type: String,
				enum: ["individual", "business", "registered_business"],
			},
		},

		// KYC Information
		kycInfo: {
			isRegistered: { type: Boolean, required: true },
			businessType: {
				type: String,
				enum: ["individual", "business"],
				required: function () {
					return !this.kycInfo?.isRegistered;
				},
			},
			cacImage: { type: String },
		},

		// Kitchen Information
		cookAddress: String,

		location: {
			type: {
				type: String,
				enum: ["Point"],
				default: "Point",
			},
			coordinates: {
				type: [Number],
				default: [0, 0],
			},
			address: {
				type: String,
				default: "",
			},
			state: {
				type: String,
				default: "",
			},
			region: {
				type: String,
				enum: ["Mainland", "Island", "Other"],
				default: "Other",
			},
		},

		kitchenPhotos: [{ type: String }],

		// Existing fields
		availableForCooking: Date,
		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		ordersCount: { type: Number, default: 0 },
		walletBalance: { type: Number, default: 0 },
		availablePickup: { type: Boolean, default: true },
		schedule: [String],
		cookingExperience: { type: String, default: "" },
		isApproved: { type: Boolean, default: false },
		isAvailable: { type: Boolean, default: false },
		isSuspended: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

// Create geospatial index
cookSchema.index({ location: "2dsphere" });

export default mongoose.model("CookProfile", cookSchema);
