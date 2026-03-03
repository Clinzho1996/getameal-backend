import axios from "axios";

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
