import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema({
	meal: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Meal",
		required: true,
	},
	quantity: {
		type: Number,
		default: 1,
	},
	price: {
		type: Number,
		required: true,
	},
});

const cartSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		items: [cartItemSchema],
	},
	{ timestamps: true },
);

export default mongoose.model("Cart", cartSchema);
