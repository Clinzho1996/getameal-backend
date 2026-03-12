import axios from "axios";
import User from "../models/User.js";

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

export const saveLocation = async (req, res) => {
	try {
		const userId = req.user.id;
		const { latitude, longitude, address } = req.body;

		if (!latitude || !longitude) {
			return res.status(400).json({
				message: "Latitude and longitude are required",
			});
		}

		const user = await User.findByIdAndUpdate(
			userId,
			{
				location: {
					type: "Point",
					coordinates: [longitude, latitude],
					address,
				},
			},
			{ new: true },
		);

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		res.status(200).json({
			message: "Location saved successfully",
			location: user.location,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to save location",
			error: error.message,
		});
	}
};

export const updateLocation = async (req, res) => {
	try {
		const userId = req.user.id;
		const { latitude, longitude, address } = req.body;

		if (!latitude || !longitude) {
			return res.status(400).json({
				message: "Latitude and longitude are required",
			});
		}

		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({
				message: "User not found",
			});
		}

		user.location = {
			type: "Point",
			coordinates: [longitude, latitude],
			address: address || user.location?.address,
		};

		await user.save();

		res.status(200).json({
			message: "Location updated successfully",
			location: user.location,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to update location",
			error: error.message,
		});
	}
};

export const getNearbyCooks = async (req, res) => {
	try {
		const { latitude, longitude, radius } = req.query;

		if (!latitude || !longitude) {
			return res.status(400).json({
				message: "Latitude and longitude are required",
			});
		}

		const searchRadius = radius ? parseInt(radius) : 5000;

		console.log(
			`Searching for cooks near [${latitude}, ${longitude}] within ${searchRadius} meters`,
		);

		// Query cooks with geocoded locations
		const cooks = await User.find({
			isCook: true, // support isCook flag
			"location.coordinates": { $exists: true },
			location: {
				$near: {
					$geometry: {
						type: "Point",
						coordinates: [parseFloat(longitude), parseFloat(latitude)],
					},
					$maxDistance: searchRadius,
				},
			},
		}).select("-walletBalance -payoutBank");

		console.log(`Found ${cooks.length} cooks`);

		res.status(200).json({
			count: cooks.length,
			cooks,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({
			message: "Failed to fetch nearby cooks",
			error: error.message,
		});
	}
};
