import axios from "axios";

export const getStates = async (req, res) => {
	try {
		const response = await axios.post(
			"https://countriesnow.space/api/v0.1/countries/states",
			{ country: "Nigeria" },
		);

		res.json(response.data.data.states);
	} catch (error) {
		res.status(500).json({ message: "Failed to fetch states" });
	}
};

export const getCitiesByState = async (req, res) => {
	try {
		const { stateCode } = req.params;

		const code = stateCode.split("-")[1]; // NG-LA → LA

		const response = await axios.get(
			`https://api.countrystatecity.in/v1/countries/NG/states/${code}/cities`,
			{
				headers: {
					"X-CSCAPI-KEY": process.env.CSC_API_KEY,
				},
			},
		);

		res.json(response.data);
	} catch (error) {
		console.error(error.response?.data || error.message);
		res.status(500).json({ message: "Failed to fetch cities" });
	}
};
