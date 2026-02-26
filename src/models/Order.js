import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
	{
		userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		cookId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		mealItems: [
			{
				mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal" },
				quantity: Number,
				price: Number,
			},
		],
		deliveryType: { type: String, enum: ["pickup", "delivery"] },
		deliveryAddress: Object,
		status: {
			type: String,
			enum: [
				"pending",
				"confirmed",
				"cooking",
				"ready",
				"out_for_delivery",
				"delivered",
				"picked_up",
				"cancelled",
			],
			default: "pending",
		},
		paymentStatus: {
			type: String,
			enum: ["pending", "paid", "refunded"],
			default: "pending",
		},
		paymentReference: String,
		friendPaymentCode: String,
		totalAmount: Number,
		serviceFee: Number,
		deliveryFee: Number,
		tax: Number,
		discount: Number,
		otpCode: String,
		otpExpires: Date,
		refundReference: String,
	},
	{ timestamps: true },
);

export default mongoose.model("Order", orderSchema);
