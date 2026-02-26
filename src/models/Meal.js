import mongoose from "mongoose";

const mealSchema = new mongoose.Schema(
	{
		cookId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		category: String,
		name: String,
		description: String,
		price: Number,
		quantityLabel: String,
		portionsTotal: Number,
		portionsRemaining: Number,
		cookingDate: Date,
		pickupWindow: {
			from: Date,
			to: Date,
		},
		deliveryRegions: [
			{
				region: String,
				fee: Number,
			},
		],
		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		ordersCount: { type: Number, default: 0 },
		status: { type: String, enum: ["open", "closed"], default: "open" },
		images: [Object],
	},
	{ timestamps: true },
);

export default mongoose.model("Meal", mealSchema);
