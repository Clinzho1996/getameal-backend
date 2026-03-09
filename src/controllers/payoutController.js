import { paystack } from "../config/paystack.js";
import CookProfile from "../models/CookProfile.js";
import WalletTransaction from "../models/WalletTransaction.js"; // make sure this import exists

export const requestPayout = async (req, res) => {
	const { amount } = req.body;

	if (req.user.role !== "cook") {
		return res.status(403).json({ message: "Only cooks can request payout" });
	}

	try {
		const cookProfile = await CookProfile.findOne({ userId: req.user._id });
		if (!cookProfile)
			return res.status(404).json({ message: "Cook profile not found" });

		if (!cookProfile.bankDetails) {
			return res
				.status(400)
				.json({ message: "Bank details not set for this cook" });
		}

		if (cookProfile.walletBalance < amount) {
			return res.status(400).json({ message: "Insufficient balance" });
		}

		// Log bank details for debugging
		console.log("Bank details:", cookProfile.bankDetails);

		// Ensure recipient exists
		let recipientCode = cookProfile.bankDetails.recipientCode;

		if (!recipientCode) {
			try {
				const recipient = await paystack.post("/transferrecipient", {
					type: "nuban",
					name: req.user.fullName,
					account_number: cookProfile.bankDetails.accountNumber,
					bank_code: cookProfile.bankDetails.bankCode,
					currency: "NGN",
				});

				console.log("Recipient creation response:", recipient.data);

				if (!recipient.data.data.recipient_code) {
					return res.status(400).json({
						message: "Failed to create transfer recipient",
						details: recipient.data,
					});
				}

				cookProfile.bankDetails.recipientCode =
					recipient.data.data.recipient_code;
				await cookProfile.save();
				recipientCode = recipient.data.data.recipient_code;
			} catch (err) {
				console.error(
					"Recipient creation error:",
					err.response?.data || err.message,
				);
				return res.status(500).json({
					message: "Recipient creation failed",
					error: err.response?.data || err.message,
				});
			}
		}

		// Perform transfer
		try {
			const transfer = await paystack.post(
				"/transfer",
				{
					source: "balance",
					amount: amount * 100, // Paystack expects kobo
					recipient: recipientCode,
				},
				{ timeout: 20000 },
			);

			console.log("Paystack transfer response:", transfer.data);
		} catch (error) {
			console.error("Paystack transfer error:", {
				message: error.message,
				response: error.response?.data,
				request: error.request?._currentUrl,
			});

			return res.status(500).json({
				message: "Paystack transfer failed",
				error: error.response?.data || error.message,
			});
		}

		// Deduct wallet balance and save transaction
		cookProfile.walletBalance -= amount;
		await cookProfile.save();

		await WalletTransaction.create({
			cookId: req.user._id,
			type: "payout",
			amount,
		});

		res.json({ message: "Payout processing" });
	} catch (err) {
		console.error("Unexpected error in requestPayout:", err);
		return res
			.status(500)
			.json({ message: "Internal server error", error: err.message });
	}
};
