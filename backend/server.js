const express = require("express");
const cors = require("cors");
const multer = require("multer");
const xlsx = require("xlsx");

const app = express();
const PORT = 5000;

app.use(
	cors({
		origin: [
			"http://localhost:3000",
			"https://football-auction-gray.vercel.app"
		],
	})
);
app.use(express.json());

const upload = multer({
	storage: multer.memoryStorage(),
	fileFilter: (req, file, cb) => {
		const allowedMimeTypes = [
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.ms-excel",
		];

		const isExcelByMime = allowedMimeTypes.includes(file.mimetype);
		const isExcelByExt = /\.(xlsx|xls)$/i.test(file.originalname || "");

		if (isExcelByMime || isExcelByExt) {
			cb(null, true);
			return;
		}

		cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
	},
});

const players = [];

function normalizeHeader(header) {
	return String(header || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

function getValueByHeader(row, aliases) {
	const normalizedAliases = aliases.map((item) => item.toLowerCase());

	for (const [key, value] of Object.entries(row)) {
		if (normalizedAliases.includes(normalizeHeader(key))) {
			return value;
		}
	}

	return undefined;
}

app.post("/upload", upload.single("file"), (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: "No file uploaded" });
		}

		const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
		const firstSheetName = workbook.SheetNames[0];

		if (!firstSheetName) {
			return res.status(400).json({ error: "Workbook has no sheets" });
		}

		const firstSheet = workbook.Sheets[firstSheetName];
		const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: "" });

		players.length = 0;

		for (const row of rows) {
			const name = getValueByHeader(row, ["name", "playername"]);
			const category = getValueByHeader(row, ["category", "cat"]);
			const position = getValueByHeader(row, ["position", "role"]);
			const avgRatingRaw = getValueByHeader(row, [
				"avgrating",
				"rating",
				"average",
			]);

			if (!name || !category || !position || avgRatingRaw === "") {
				continue;
			}

			const avgRating = Number(avgRatingRaw);

			players.push({
				name: String(name).trim(),
				category: String(category).trim(),
				position: String(position).trim(),
				avgRating: Number.isNaN(avgRating) ? 0 : avgRating,
				isSold: false,
			});
		}

		return res.json({
			message: "Players uploaded successfully",
			totalPlayers: players.length,
			players,
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Upload failed" });
	}
});

app.get("/draw", (req, res) => {
	const { category } = req.query;
	const unsoldPlayers = players.filter((player) => !player.isSold);

	if (unsoldPlayers.length === 0) {
		return res.status(404).json({ error: "No unsold players available" });
	}

	const requestedCategory = String(category || "").trim().toLowerCase();
	const pool = requestedCategory
		? unsoldPlayers.filter(
				(player) => String(player.category || "").trim().toLowerCase() === requestedCategory
		  )
		: unsoldPlayers;

	if (pool.length === 0) {
		return res.status(404).json({
			error: `No unsold players available for category '${category}'`,
		});
	}

	const randomIndex = Math.floor(Math.random() * pool.length);
	const randomPlayer = pool[randomIndex];

	return res.json(randomPlayer);
});

app.post("/sold", (req, res) => {
	const { name } = req.body || {};

	if (!name) {
		return res.status(400).json({ error: "Player name is required" });
	}

	const player = players.find(
		(item) => item.name.toLowerCase() === String(name).toLowerCase()
	);

	if (!player) {
		return res.status(404).json({ error: "Player not found" });
	}

	if (player.isSold) {
		return res.status(400).json({ error: "Player is already sold" });
	}

	player.isSold = true;

	return res.json({ message: "Player marked as sold", player });
});

app.use((error, req, res, next) => {
	if (error instanceof multer.MulterError) {
		return res.status(400).json({ error: error.message });
	}

	if (error) {
		return res.status(400).json({ error: error.message || "Request failed" });
	}

	return next();
});

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
