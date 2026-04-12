import Meal from "../models/Meal.js";
import Review from "../models/Review.js";
import User from "../models/User.js";

export const seedMealReviews = async (req, res) => {
	try {
		const meals = await Meal.find();

		const rawReviews = [
			{
				name: "Adaeze Nwosu",
				text: "The soup was rich and thick, the kind that reminds you of your grandmother's kitchen. Everything arrived warm and perfect.",
			},
			{
				name: "Tunde Afolabi",
				text: "This was the best jollof rice I have eaten outside my mother's house. Smoky, balanced, and very satisfying.",
			},
			{
				name: "Ngozi Eze",
				text: "The egusi was properly fried, not watery. The aroma hit immediately I opened the pack.",
			},
			{
				name: "Emeka Okafor",
				text: "Very well prepared meal. The meat was soft and well seasoned. I enjoyed it.",
			},
			{
				name: "Fatima Bello",
				text: "Authentic northern taste. This reminded me of home. Everything was done right.",
			},
			{
				name: "Blessing Udoh",
				text: "This tasted like home. Authentic flavor and very satisfying portion.",
			},
			{
				name: "Chidi Obi",
				text: "Everything was balanced. You can tell the cook knows what they are doing.",
			},
			{
				name: "Kemi Adeyemi",
				text: "Absolutely delicious. Properly prepared and well packaged.",
			},
			{
				name: "Samuel Adeyinka",
				text: "Very good portion and taste. I will definitely order again.",
			},
			{
				name: "Amaka Nzekwe",
				text: "Rich, tasty, and very filling. Worth every naira.",
			},
			{
				name: "Ibrahim Musa",
				text: "Perfectly cooked and well seasoned. I enjoyed every bite.",
			},
			{
				name: "Chioma Nwofor",
				text: "The consistency and taste were excellent. Very impressed.",
			},
			{
				name: "Yetunde Olatunji",
				text: "This is proper Nigerian cooking. Everything was done right.",
			},
			{
				name: "Biodun Fasanya",
				text: "Very flavorful and well prepared. I will recommend this.",
			},
			{
				name: "Uche Onyekachi",
				text: "Great taste and portion. I really enjoyed this meal.",
			},
			{
				name: "Remi Adewale",
				text: "Clean, tasty, and well cooked. No complaints at all.",
			},
		];

		const keywordMap = {
			jollof: ["jollof"],
			egusi: ["egusi"],
			oha: ["oha"],
			afang: ["afang"],
			edikang: ["edikang"],
			efo: ["efo"],
			fisherman: ["fisherman", "seafood"],
			chicken: ["chicken"],
			rice: ["rice"],
			stew: ["stew"],
		};

		const userCache = {};

		const getUser = async (name) => {
			if (userCache[name]) return userCache[name];

			let user = await User.findOne({ fullName: name });

			if (!user) {
				user = await User.create({
					fullName: name,
					email: `${name.replace(/ /g, "").toLowerCase()}@seed.com`,
					password: "123456",
				});
			}

			userCache[name] = user;
			return user;
		};

		let reviewIndex = 0;
		let totalCreated = 0;

		for (const meal of meals) {
			const existingCount = await Review.countDocuments({
				targetId: meal._id,
				targetType: "meal",
			});

			const needed = 4 - existingCount;
			if (needed <= 0) continue;

			const mealName = meal.name.toLowerCase();

			let matchedReviews = rawReviews.filter((r) => {
				return Object.keys(keywordMap).some((key) => {
					return (
						mealName.includes(key) &&
						keywordMap[key].some((k) => r.text.toLowerCase().includes(k))
					);
				});
			});

			if (matchedReviews.length === 0) {
				matchedReviews = rawReviews;
			}

			for (let i = 0; i < needed; i++) {
				const reviewData =
					matchedReviews[(reviewIndex + i) % matchedReviews.length];

				const user = await getUser(reviewData.name);

				const exists = await Review.findOne({
					user: user._id,
					targetId: meal._id,
					targetType: "meal",
				});

				if (exists) continue;

				await Review.create({
					user: user._id,
					targetId: meal._id,
					targetType: "meal",
					rating: 5,
					comment: reviewData.text,
				});

				totalCreated++;
			}

			reviewIndex++;

			const allReviews = await Review.find({
				targetId: meal._id,
				targetType: "meal",
			});

			const avg =
				allReviews.reduce((acc, r) => acc + r.rating, 0) /
				(allReviews.length || 1);

			meal.rating = avg;
			meal.reviewsCount = allReviews.length;

			await meal.save();
		}

		res.json({
			message: "Smart reviews seeded successfully",
			totalCreated,
			totalMeals: meals.length,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};
