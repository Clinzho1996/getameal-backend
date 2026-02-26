// middleware/upload.js
import multer from "multer";
import path from "path";

// Temporary storage on server
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, "uploads/");
	},
	filename: function (req, file, cb) {
		cb(
			null,
			Date.now() + "-" + file.fieldname + path.extname(file.originalname),
		);
	},
});

export const upload = multer({ storage });
