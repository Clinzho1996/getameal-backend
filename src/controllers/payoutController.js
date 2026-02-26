import { paystack } from "../config/paystack.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const requestPayout = async (req, res) => {
	const { amount } = req.body;

	const cook = await User.findById(req.user._id);

	if (cook.walletBalance < amount)
		return res.status(400).json({ message: "Insufficient balance" });

	await paystack.post("/transfer", {
		source: "balance",
		amount: amount * 100,
		recipient: cook.bankDetails.recipientCode,
	});

	cook.walletBalance -= amount;
	await cook.save();

	await WalletTransaction.create({
		cookId: cook._id,
		type: "payout",
		amount,
	});

	res.json({ message: "Payout processing" });
};
