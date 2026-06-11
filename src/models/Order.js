import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		totalAmount: { type: Number, required: true },

		mealItems: [
			{
				mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal" },
				quantity: Number,
				price: Number,
			},
		],

		deliveryType: { type: String, enum: ["pickup", "delivery"] },
		deliveryAddress: Object,

		// ✅ ADD THIS
		note: {
			type: String,
			default: "",
		},

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
		serviceFee: Number,
		deliveryFee: {
			type: Number,
			default: 0,
		},

		selectedRegion: {
			type: String,
			enum: ["Mainland", "Island"],
			default: null,
		},

		tax: Number,
		discount: Number,
		deliveryOtp: {
			type: String,
			sparse: true,
			index: true,
		},

		otpGeneratedAt: {
			type: Date,
			default: null,
		},

		refundReference: String,
	},
	{ timestamps: true },
);

export default mongoose.model("Order", orderSchema);
