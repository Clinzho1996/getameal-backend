import mongoose from "mongoose";

const cookSchema = new mongoose.Schema(
	{
		userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		ordersCount: { type: Number, default: 0 },
		availablePickup: Boolean,
		deliveryFee: Number,
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
