import Cart from "../models/Cart.js";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import User from "../models/User.js";

export const addToCart = async (req, res) => {
	try {
		const userId = req.user.id;
		const { items, deliveryType, deliveryRegion } = req.body;

		if (!items || !Array.isArray(items)) {
			return res.status(400).json({ message: "Items array is required" });
		}

		let cart = await Cart.findOne({ user: userId });

		if (!cart) {
			cart = new Cart({ user: userId, items: [] });
		}

		// ✅ Track delivery types per cook for validation
		const cookDeliveryTypes = new Map(); // cookId -> { hasPickupOnly: bool, hasDeliveryOnly: bool, cookName: string }

		// Get existing cart items delivery types
		for (const cartItem of cart.items) {
			const meal = await Meal.findById(cartItem.meal);
			if (meal) {
				const cookId = meal.cookId?.toString();
				if (!cookId) continue;

				if (!cookDeliveryTypes.has(cookId)) {
					const cook = await User.findById(cookId);
					const cookProfile = await CookProfile.findOne({ userId: cookId });
					const name = cookProfile?.cookDisplayName || cook?.fullName || "Cook";

					cookDeliveryTypes.set(cookId, {
						hasPickupOnly: false,
						hasDeliveryOnly: false,
						cookName: name,
					});
				}

				const cookData = cookDeliveryTypes.get(cookId);

				// ✅ Check delivery mode from meal
				const deliveryMode = meal.deliveryMode || "both";

				if (deliveryMode === "pickup_only") {
					cookData.hasPickupOnly = true;
				} else if (deliveryMode === "delivery_only") {
					cookData.hasDeliveryOnly = true;
				} else {
					// 'both' - check if it has delivery regions
					const hasDeliveryRegions =
						meal.deliveryRegions && meal.deliveryRegions.length > 0;
					if (hasDeliveryRegions) {
						cookData.hasDeliveryOnly = true;
					}
					cookData.hasPickupOnly = true; // both means pickup is available
				}
			}
		}

		// ✅ Check new items and validate
		const newItems = [];
		const validationErrors = [];

		for (const item of items) {
			const meal = await Meal.findById(item.mealId);

			if (!meal) {
				return res.status(404).json({
					message: `Meal not found: ${item.mealId}`,
				});
			}

			const cookId = meal.cookId?.toString();
			if (!cookId) {
				return res.status(400).json({
					message: `Meal "${meal.name}" has no cook associated`,
				});
			}

			// Get or create cook data
			if (!cookDeliveryTypes.has(cookId)) {
				const cook = await User.findById(cookId);
				const cookProfile = await CookProfile.findOne({ userId: cookId });
				const name = cookProfile?.cookDisplayName || cook?.fullName || "Cook";

				cookDeliveryTypes.set(cookId, {
					hasPickupOnly: false,
					hasDeliveryOnly: false,
					cookName: name,
				});
			}

			const cookData = cookDeliveryTypes.get(cookId);

			// ✅ Get delivery mode from meal
			const deliveryMode = meal.deliveryMode || "both";

			// Check if meal has delivery regions
			const hasDeliveryRegions =
				meal.deliveryRegions && meal.deliveryRegions.length > 0;

			// Determine if this meal can be delivered to the selected region
			let canBeDelivered = false;
			if (hasDeliveryRegions && deliveryType === "delivery") {
				canBeDelivered = meal.deliveryRegions.some(
					(r) => r.region === deliveryRegion,
				);
			}

			// ✅ VALIDATION 1: Check delivery mode
			if (deliveryMode === "pickup_only" && deliveryType === "delivery") {
				validationErrors.push(
					`"${meal.name}" from "${cookData.cookName}" is available for pickup only, but you selected delivery. Please change to pickup or remove this item.`,
				);
			}

			if (deliveryMode === "delivery_only" && deliveryType === "pickup") {
				validationErrors.push(
					`"${meal.name}" from "${cookData.cookName}" is available for delivery only, but you selected pickup. Please change to delivery or remove this item.`,
				);
			}

			// ✅ VALIDATION 2: Check if delivery is available for the selected region
			if (deliveryType === "delivery" && deliveryMode !== "pickup_only") {
				if (!hasDeliveryRegions) {
					validationErrors.push(
						`"${meal.name}" from "${cookData.cookName}" has no delivery regions configured. Please contact the cook or choose pickup.`,
					);
				} else if (!canBeDelivered) {
					const availableRegions = meal.deliveryRegions
						.map((r) => r.region)
						.join(", ");
					validationErrors.push(
						`"${meal.name}" from "${cookData.cookName}" is not available for delivery to "${deliveryRegion}". Available regions: ${availableRegions}`,
					);
				}
			}

			// ✅ VALIDATION 3: Check mixing pickup and delivery from same cook
			const isPickupOnly = deliveryMode === "pickup_only";
			const isDeliveryOnly = deliveryMode === "delivery_only";
			const isBoth = deliveryMode === "both";

			if (isPickupOnly && cookData.hasDeliveryOnly) {
				validationErrors.push(
					`Cannot add "${meal.name}" (pickup only) to cart. Your cart already has delivery items from "${cookData.cookName}". Please checkout your delivery items first, or remove them to add pickup items.`,
				);
			}

			if (isDeliveryOnly && cookData.hasPickupOnly) {
				validationErrors.push(
					`Cannot add "${meal.name}" (delivery only) to cart. Your cart already has pickup items from "${cookData.cookName}". Please checkout your pickup items first, or remove them to add delivery items.`,
				);
			}

			// ✅ VALIDATION 4: If both, but existing cart has only one type, ensure consistency
			if (isBoth) {
				if (
					cookData.hasPickupOnly &&
					!cookData.hasDeliveryOnly &&
					deliveryType === "delivery"
				) {
					validationErrors.push(
						`Your cart already has pickup items from "${cookData.cookName}". To add "${meal.name}" as delivery, please checkout your pickup items first, or remove them.`,
					);
				}
				if (
					cookData.hasDeliveryOnly &&
					!cookData.hasPickupOnly &&
					deliveryType === "pickup"
				) {
					validationErrors.push(
						`Your cart already has delivery items from "${cookData.cookName}". To add "${meal.name}" as pickup, please checkout your delivery items first, or remove them.`,
					);
				}
			}

			newItems.push({
				meal: meal._id,
				mealName: meal.name,
				cookId: cookId,
				cookName: cookData.cookName,
				deliveryMode: deliveryMode,
				isPickupOnly: isPickupOnly,
				isDeliveryOnly: isDeliveryOnly,
				isBoth: isBoth,
				quantity: item.quantity || 1,
				price: meal.price,
			});

			// Update cook delivery types for future validation
			if (isPickupOnly) {
				cookData.hasPickupOnly = true;
			}
			if (isDeliveryOnly || (isBoth && deliveryType === "delivery")) {
				cookData.hasDeliveryOnly = true;
			}
			if (isBoth && deliveryType === "pickup") {
				cookData.hasPickupOnly = true;
			}
		}

		// ✅ If there are validation errors, return them
		if (validationErrors.length > 0) {
			return res.status(400).json({
				success: false,
				message: "Cannot add items to cart",
				errors: validationErrors,
			});
		}

		// ✅ Add items to cart
		let addedCount = 0;
		for (const newItem of newItems) {
			const existingItem = cart.items.find(
				(cartItem) => cartItem.meal.toString() === newItem.meal.toString(),
			);

			if (existingItem) {
				existingItem.quantity += newItem.quantity;
			} else {
				cart.items.push({
					meal: newItem.meal,
					quantity: newItem.quantity,
					price: newItem.price,
				});
			}
			addedCount++;
		}

		await cart.save();

		// Populate cart items with meal details for response
		const populatedCart = await Cart.findById(cart._id).populate({
			path: "items.meal",
			populate: {
				path: "cookId",
				select: "fullName",
			},
		});

		// Recalculate validation for response
		const validationData = {
			hasPickupOnly: false,
			hasDeliveryOnly: false,
			cooks: [],
		};

		const cookMap = new Map();
		for (const item of populatedCart.items) {
			if (!item.meal) continue;
			const cookId = item.meal.cookId?._id?.toString();
			if (!cookId) continue;

			if (!cookMap.has(cookId)) {
				const cookProfile = await CookProfile.findOne({ userId: cookId });
				cookMap.set(cookId, {
					cookId,
					cookName:
						cookProfile?.cookDisplayName ||
						item.meal.cookId?.fullName ||
						"Cook",
					hasPickupOnly: false,
					hasDeliveryOnly: false,
				});
			}

			const cookData = cookMap.get(cookId);
			const deliveryMode = item.meal.deliveryMode || "both";

			if (deliveryMode === "pickup_only") {
				cookData.hasPickupOnly = true;
				validationData.hasPickupOnly = true;
			} else if (deliveryMode === "delivery_only") {
				cookData.hasDeliveryOnly = true;
				validationData.hasDeliveryOnly = true;
			} else {
				// both
				cookData.hasPickupOnly = true;
				if (item.meal.deliveryRegions && item.meal.deliveryRegions.length > 0) {
					cookData.hasDeliveryOnly = true;
				}
				validationData.hasPickupOnly = true;
			}
		}

		validationData.cooks = Array.from(cookMap.values());

		res.json({
			success: true,
			message: `${addedCount} item(s) added to cart`,
			cart: populatedCart,
			validation: validationData,
		});
	} catch (error) {
		console.error("Add to cart error:", error);
		res.status(500).json({
			success: false,
			message: "Failed to add items to cart",
			error: error.message,
		});
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

export const getCart = async (req, res) => {
	try {
		const userId = req.user.id;

		const cart = await Cart.findOne({ user: userId }).populate({
			path: "items.meal",
			populate: {
				path: "cookId",
				select: "fullName",
			},
		});

		if (!cart) {
			return res.json({
				success: true,
				cart: { items: [], totalItems: 0, totalPrice: 0 },
				validation: {
					hasMixedTypes: false,
					cooks: [],
					warnings: [],
				},
			});
		}

		let totalItems = 0;
		let totalPrice = 0;
		const cookDeliveryTypes = new Map();

		// Analyze cart items
		for (const item of cart.items) {
			totalItems += item.quantity;
			totalPrice += item.price * item.quantity;

			if (item.meal) {
				const meal = item.meal;
				const cookId = meal.cookId?._id?.toString() || meal.cookId?.toString();

				if (cookId) {
					if (!cookDeliveryTypes.has(cookId)) {
						const cookName = meal.cookId?.fullName || "Cook";
						cookDeliveryTypes.set(cookId, {
							cookName,
							hasPickupOnly: false,
							hasDeliveryOnly: false,
							items: [],
						});
					}

					const cookData = cookDeliveryTypes.get(cookId);
					const hasDeliveryRegions =
						meal.deliveryRegions && meal.deliveryRegions.length > 0;

					if (!hasDeliveryRegions) {
						cookData.hasPickupOnly = true;
					} else {
						cookData.hasDeliveryOnly = true;
					}

					cookData.items.push({
						mealId: meal._id,
						name: meal.name,
						quantity: item.quantity,
						price: item.price,
						hasDeliveryRegions,
					});
				}
			}
		}

		// Check for mixed types per cook
		let hasMixedTypes = false;
		const warnings = [];
		const cookSummaries = [];

		for (const [cookId, data] of cookDeliveryTypes) {
			const isMixed = data.hasPickupOnly && data.hasDeliveryOnly;
			if (isMixed) {
				hasMixedTypes = true;
				warnings.push(
					`Your cart has both pickup and delivery items from "${data.cookName}". Please checkout your current basket first, or remove items to have only one delivery type from this cook.`,
				);
			}

			cookSummaries.push({
				cookId,
				cookName: data.cookName,
				hasPickupOnly: data.hasPickupOnly,
				hasDeliveryOnly: data.hasDeliveryOnly,
				isMixed: isMixed,
				itemCount: data.items.length,
				items: data.items.map((i) => ({
					name: i.name,
					quantity: i.quantity,
					price: i.price,
				})),
			});
		}

		res.json({
			success: true,
			cart: {
				items: cart.items,
				totalItems,
				totalPrice,
			},
			validation: {
				hasMixedTypes,
				warnings,
				cooks: cookSummaries,
			},
		});
	} catch (error) {
		console.error("Get cart error:", error);
		res.status(500).json({
			success: false,
			message: "Failed to get cart",
			error: error.message,
		});
	}
};
