import Cart from "../models/Cart.js";
import Meal from "../models/Meal.js";

export const addToCart = async (req, res) => {
	try {
		const userId = req.user.id;
		const { items } = req.body;

		if (!items || !Array.isArray(items)) {
			return res.status(400).json({ message: "Items array is required" });
		}

		let cart = await Cart.findOne({ user: userId });

		if (!cart) {
			cart = new Cart({ user: userId, items: [] });
		}

		for (const item of items) {
			const meal = await Meal.findById(item.mealId);

			if (!meal) {
				return res.status(404).json({
					message: `Meal not found: ${item.mealId}`,
				});
			}

			const existingItem = cart.items.find(
				(cartItem) => cartItem.meal.toString() === item.mealId,
			);

			if (existingItem) {
				existingItem.quantity += item.quantity || 1;
			} else {
				cart.items.push({
					meal: item.mealId,
					quantity: item.quantity || 1,
					price: meal.price,
				});
			}
		}

		await cart.save();

		res.json({
			message: "Items added to cart",
			cart,
		});
	} catch (error) {
		res.status(500).json({ message: "Failed to add items to cart" });
	}
};

export const removeFromCart = async (req, res) => {
	try {
		const userId = req.user.id;
		const { mealId } = req.params;

		const cart = await Cart.findOne({ user: userId });
		if (!cart) {
			return res.status(404).json({ message: "Cart not found" });
		}

		cart.items = cart.items.filter((item) => item.meal.toString() !== mealId);

		await cart.save();

		res.json(cart);
	} catch (error) {
		res.status(500).json({ message: "Failed to remove item" });
	}
};
