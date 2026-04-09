import axios from "axios";
import CookProfile from "../models/CookProfile.js";
import { createAdminNotification } from "../utils/adminNotification.js";

export const getBanks = async (req, res) => {
	try {
		const response = await axios.get("https://api.paystack.co/bank", {
			headers: {
				Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
			},
		});

		res.json(response.data.data);
	} catch (error) {
		res.status(500).json({
			message: "Failed to fetch banks",
		});
	}
};

export const verifyAccount = async (req, res) => {
	const { accountNumber, bankCode } = req.body;

	try {
		const response = await axios.get(
			`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		res.json(response.data.data);
	} catch (error) {
		res.status(400).json({
			message: "Invalid account",
		});
	}
};

export const addCookBankAccount = async (req, res) => {
	try {
		const { accountNumber, bankCode, bankName } = req.body;
		const userId = req.user.id;

		if (!accountNumber || !bankCode) {
			return res.status(400).json({
				message: "Account number and bank code are required",
			});
		}

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		if (cook.bankDetails?.accountNumber) {
			return res.status(400).json({
				message: "Bank account already exists. Use update instead.",
			});
		}

		const response = await axios.get(
			`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		const { account_name } = response.data.data;

		cook.bankDetails = {
			accountNumber,
			bankCode,
			bankName,
			accountName: account_name,
		};

		await cook.save();

		res.status(201).json({
			message: "Bank account added successfully",
			bankDetails: cook.bankDetails,
		});

		await createAdminNotification({
			title: "Bank Account Added",
			body: `A new bank account was added for ${req.user.fullName}`,
			type: "cook",
			data: { cookId: cook._id },
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to add bank account",
			error: error.message,
		});
	}
};

export const updateCookBankAccount = async (req, res) => {
	try {
		const { accountNumber, bankCode, bankName } = req.body;
		const userId = req.user.id;

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		const response = await axios.get(
			`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		const { account_name } = response.data.data;

		cook.bankDetails = {
			accountNumber,
			bankCode,
			bankName,
			accountName: account_name,
		};

		await cook.save();

		await createAdminNotification({
			title: "Bank Account Updated",
			body: `The bank account for ${req.user.fullName} was updated`,
			type: "cook",
			data: { cookId: cook._id },
		});

		res.json({
			message: "Bank account updated successfully",
			bankDetails: cook.bankDetails,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to update bank account",
			error: error.message,
		});
	}
};

export const deleteCookBankAccount = async (req, res) => {
	try {
		const userId = req.user.id;

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		cook.bankDetails = undefined;

		await cook.save();

		await createAdminNotification({
			title: "Bank Account Removed",
			body: `The bank account for ${req.user.fullName} was removed`,
			type: "cook",
			data: { cookId: cook._id },
		});

		res.json({
			message: "Bank account removed successfully",
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to delete bank account",
			error: error.message,
		});
	}
};
