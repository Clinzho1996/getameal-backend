import Cart from "../models/Cart.js";
import Meal from "../models/Meal.js";

export const addToCart = async (req, res) => {
	try {
		const userId = req.user.id;
		const { mealId, quantity } = req.body;

		const meal = await Meal.findById(mealId);
		if (!meal) {
			return res.status(404).json({ message: "Meal not found" });
		}

		let cart = await Cart.findOne({ user: userId });

		if (!cart) {
			cart = new Cart({ user: userId, items: [] });
		}

		const existingItem = cart.items.find(
			(item) => item.meal.toString() === mealId,
		);

		if (existingItem) {
			existingItem.quantity += quantity || 1;
		} else {
			cart.items.push({
				meal: mealId,
				quantity: quantity || 1,
				price: meal.price,
			});
		}

		await cart.save();
		res.json(cart);
	} catch (error) {
		res.status(500).json({ message: "Failed to add to cart" });
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
