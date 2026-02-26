import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
	{
		cookId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		type: { type: String, enum: ["credit", "debit", "payout"] },
		amount: Number,
		reference: String,
		status: { type: String, default: "success" },
	},
	{ timestamps: true },
);

export default mongoose.model("WalletTransaction", walletSchema);
