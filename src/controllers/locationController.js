import axios from "axios";
import City from "../models/City.js";
import User from "../models/User.js";
import { getCityCoordinates } from "../utils/geoCode.js";

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

		// Extract LA from NG-LA
		const code = stateCode.split("-")[1];

		// 1. Check DB cache first
		const existingCities = await City.find({ stateCode: code });

		if (existingCities.length > 0) {
			return res.json(existingCities);
		}

		// 2. Fetch from CountryStateCity API
		const response = await axios.get(
			`https://api.countrystatecity.in/v1/countries/NG/states/${code}/cities`,
			{
				headers: {
					"X-CSCAPI-KEY": process.env.CSC_API_KEY,
				},
			},
		);

		const cities = response.data;

		// 3. Enrich with coordinates (IMPORTANT: rate-limit safe)
		const enrichedCities = [];

		for (const city of cities) {
			const coords = await getCityCoordinates(city.name, code);

			const newCity = {
				name: city.name,
				stateCode: code,
				latitude: coords?.lat || null,
				longitude: coords?.lng || null,
			};

			enrichedCities.push(newCity);

			// Optional: small delay to avoid rate limits
			await new Promise((resolve) => setTimeout(resolve, 200));
		}

		// 4. Save to DB
		await City.insertMany(enrichedCities);

		// 5. Return response
		res.json(enrichedCities);
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

		// ===== 1. NEARBY =====
		let cooks = await User.find({
			isCook: true,
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

		// ===== Get user location info (you must pass this from frontend or reverse geocode) =====
		const userState = req.query.state;
		const userRegion = req.query.region;

		// ===== 2. REGION FALLBACK =====
		if (cooks.length === 0 && userRegion) {
			cooks = await User.find({
				isCook: true,
				"location.region": userRegion.toLowerCase(),
			}).select("-walletBalance -payoutBank");
		}

		// ===== 3. STATE FALLBACK =====
		if (cooks.length === 0 && userState) {
			cooks = await User.find({
				isCook: true,
				"location.state": userState,
			}).select("-walletBalance -payoutBank");
		}

		// ===== 4. LAST RESORT =====
		if (cooks.length === 0) {
			cooks = await User.find({ isCook: true })
				.limit(20)
				.select("-walletBalance -payoutBank");
		}

		res.json({
			count: cooks.length,
			cooks,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to fetch cooks",
			error: error.message,
		});
	}
};
