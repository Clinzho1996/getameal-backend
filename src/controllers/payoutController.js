import { paystack } from "../config/paystack.js";
import CookProfile from "../models/CookProfile.js";
import PendingTransfer from "../models/PendingTransfer.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const requestPayout = async (req, res) => {
	const { amount } = req.body;

	if (req.user.role !== "cook") {
		return res.status(403).json({ message: "Only cooks can request payout" });
	}

	try {
		const cookProfile = await CookProfile.findOne({ userId: req.user._id });
		if (!cookProfile)
			return res.status(404).json({ message: "Cook profile not found" });

		if (!cookProfile.bankDetails)
			return res.status(400).json({ message: "Bank details not set" });

		if (cookProfile.walletBalance < amount)
			return res.status(400).json({ message: "Insufficient balance" });

		let recipientCode = cookProfile.bankDetails.recipientCode;

		// Create recipient if missing
		if (!recipientCode) {
			const recipient = await paystack.post("/transferrecipient", {
				type: "nuban",
				name: req.user.fullName,
				account_number: cookProfile.bankDetails.accountNumber,
				bank_code: cookProfile.bankDetails.bankCode,
				currency: "NGN",
			});

			if (!recipient.data.data.recipient_code) {
				console.error("Paystack recipient creation failed", recipient.data);
				return res
					.status(500)
					.json({ message: "Failed to create transfer recipient" });
			}

			cookProfile.bankDetails.recipientCode =
				recipient.data.data.recipient_code;
			await cookProfile.save();
			recipientCode = recipient.data.data.recipient_code;
		}

		// Initiate transfer
		const transfer = await paystack.post("/transfer", {
			source: "balance",
			amount: amount * 100, // kobo
			recipient: recipientCode,
		});

		const transferData = transfer.data.data;

		// Record a pending transfer internally, regardless of OTP
		await PendingTransfer.create({
			cookId: req.user._id,
			amount,
			transferCode: transferData.transfer_code,
			status: transferData.status === "otp" ? "pending_otp" : "pending",
		});

		console.log("Paystack transfer initiated", transferData);

		// Always return a generic response to the cook
		return res.status(200).json({
			message: "Payout request received and is being processed",
			amount,
		});
	} catch (err) {
		console.error(
			"Payout initiation error:",
			err.response?.data || err.message,
		);
		return res.status(500).json({
			message: "Payout initiation failed",
			error: err.response?.data || err.message,
		});
	}
};

export const verifyPayoutOTP = async (req, res) => {
	const { transferCode, otp } = req.body;

	if (!transferCode || !otp) {
		return res
			.status(400)
			.json({ message: "transferCode and OTP are required" });
	}

	try {
		// 1. Find the pending transfer in our DB
		const pendingTransfer = await PendingTransfer.findOne({
			transferCode,
			status: "pending_otp",
		});

		if (!pendingTransfer) {
			return res.status(404).json({
				message: "Pending transfer not found or already completed",
			});
		}

		const amount = pendingTransfer.amount;

		// 2. Check transfer status from Paystack
		const statusResponse = await paystack.get(`/transfer/${transferCode}`);
		const transferData = statusResponse.data.data;

		if (!transferData) {
			return res
				.status(404)
				.json({ message: "Transfer not found on Paystack" });
		}

		const currentStatus = transferData.status; // 'otp', 'success', etc.
		const recipientId = transferData.recipient; // this is an ID or string

		// 3. Look up cook profile by recipientCode (string saved earlier)
		const cookProfile = await CookProfile.findOne({
			"bankDetails.recipientCode": transferData.recipient_code || undefined,
		});

		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// 4. If transfer already succeeded
		if (currentStatus === "success") {
			// Only finalize wallet if transaction doesn't exist yet
			const existingTransaction = await WalletTransaction.findOne({
				cookId: cookProfile.userId,
				type: "payout",
				amount,
			});

			if (!existingTransaction) {
				cookProfile.walletBalance -= amount;
				await cookProfile.save();

				await WalletTransaction.create({
					cookId: cookProfile.userId,
					type: "payout",
					amount,
				});
			}

			pendingTransfer.status = "completed";
			await pendingTransfer.save();

			return res.json({ message: "Payout already processed successfully" });
		}

		// 5. If OTP is required, finalize transfer
		if (currentStatus === "otp") {
			const verification = await paystack.post("/transfer/finalize_transfer", {
				transfer_code: transferCode,
				otp,
			});

			const verifiedData = verification.data.data || verification.data;

			if (verifiedData.status !== "success") {
				return res.status(400).json({
					message: "OTP verification failed",
					details: verifiedData,
				});
			}

			// Deduct wallet and record transaction
			cookProfile.walletBalance -= amount;
			await cookProfile.save();

			await WalletTransaction.create({
				cookId: cookProfile.userId,
				type: "payout",
				amount,
			});

			pendingTransfer.status = "completed";
			await pendingTransfer.save();

			return res.json({
				message: "Payout verified and completed successfully",
			});
		}

		// 6. Any other unexpected status
		return res.status(400).json({
			message: `Cannot process transfer in status: ${currentStatus}`,
			details: transferData,
		});
	} catch (err) {
		console.error("OTP verification error:", err.response?.data || err.message);
		return res.status(500).json({
			message: "OTP verification failed",
			error: err.response?.data || err.message,
		});
	}
};
