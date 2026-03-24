import mongoose from "mongoose";

const cookSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		cookName: { type: String, required: false },
		phone: { type: String },
		cookAddress: String,
		cookingExperience: String,
		availableForCooking: Date,
		location: {
			type: { type: String, enum: ["Point"] },
			coordinates: [Number],
			address: String,
		},
		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		ordersCount: { type: Number, default: 0 },
		walletBalance: { type: Number, default: 0 },
		availablePickup: { type: Boolean, default: true },
		schedule: [String],
		bankDetails: {
			bankName: String,
			bankCode: String,
			accountNumber: String,
			accountName: String,
			recipientCode: String,
		},
		isApproved: { type: Boolean, default: false },
		isAvailable: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

export default mongoose.model("CookProfile", cookSchema);
