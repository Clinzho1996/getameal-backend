import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
	{
		email: { type: String, unique: true },
		fullName: String, // user's real name
		phone: String,
		role: {
			type: String,
			enum: [
				"user",
				"admin",
				"operations agent",
				"operations manager",
				"customer support",
			],
			default: "user",
		}, // remove 'cook' from enum
		isCook: { type: Boolean, default: false }, // true if the user has a cook profile
		bio: String,
		profileImage: Object,
		coverImage: Object,
		location: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: [Number],
			address: String,
			state: String, // "Lagos", "Abuja", "Rivers"
			region: String, // "island", "mainland", "abuja", etc.
		},
		// Add fields for referral
		referralCode: { type: String, unique: true, sparse: true },
		referredBy: { type: mongoose.Types.ObjectId, ref: "User", default: null },
		savedCooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
		pushTokens: {
			type: [
				{
					token: { type: String, required: true },
					platform: { type: String, enum: ["ios", "android"], required: true },
					deviceId: { type: mongoose.Schema.Types.Mixed, default: null },
					lastUsed: { type: Date, default: Date.now },
					createdAt: { type: Date, default: Date.now },
				},
			],
			default: [],
		},
		notes: {
			type: [
				{
					note: String,
					createdAt: { type: Date, default: Date.now },
				},
			],
			default: [],
		},
		zone: {
			type: String, // e.g. "lekki", "ikeja"
		},
		notificationSettings: {
			push_enabled: { type: Boolean, default: true },
			email_enabled: { type: Boolean, default: true },
			transactions: { type: Boolean, default: true },
			promotions: { type: Boolean, default: false },
		},
		isVerified: { type: Boolean, default: false },
		favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
		password: {
			type: String,
			required: function () {
				return this.role === "admin";
			},
			select: false,
		},
	},
	{ timestamps: true },
);

userSchema.index({ location: "2dsphere" });

export default mongoose.model("User", userSchema);
