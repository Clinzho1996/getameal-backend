import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
	{
		email: { type: String, unique: true },
		fullName: String, // user's real name
		phone: String,
		role: { type: String, enum: ["user", "admin"], default: "user" }, // remove 'cook' from enum
		isCook: { type: Boolean, default: false }, // true if the user has a cook profile
		bio: String,
		profileImage: Object,
		coverImage: Object,
		location: {
			type: { type: String, enum: ["Point"] },
			coordinates: [Number],
			address: String,
		},
		savedCooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
		notificationToken: String,
		isVerified: { type: Boolean, default: false },
		favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
	},
	{ timestamps: true },
);

userSchema.index({ location: "2dsphere" });

export default mongoose.model("User", userSchema);
