import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
	{
		email: { type: String, unique: true },
		fullName: String,
		phone: String,
		role: { type: String, enum: ["user", "admin"], default: "user" },
		isCook: { type: Boolean, default: false },
		bio: String,
		profileImage: Object,
		coverImage: Object,
		location: {
			type: { type: String, enum: ["Point"] },
			coordinates: [Number],
			address: String,
		},
		walletBalance: { type: Number, default: 0 },
		savedCooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
		notificationToken: String,
		isVerified: { type: Boolean, default: false },
		cookAddress: String,
		cookingExperience: { type: String },
		availableForCooking: { type: Date },
		cookSince: { type: Date },
		pickupAvailable: { type: Boolean, default: true },
		favorites: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
			},
		],
	},
	{ timestamps: true },
);

userSchema.index({ location: "2dsphere" });

export default mongoose.model("User", userSchema);
