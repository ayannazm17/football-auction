const express = require("express");
const cors = require("cors");
const path = require('path');
const multer = require("multer");
const xlsx = require("xlsx");
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL || 'https://your-temporary-vercel-link.app' // We will set this in Render's dashboard
];

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST'],
  credentials: true
}));
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
const unsoldPool = [];

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

function normalizeCategoryToShortForm(category) {
	const normalized = String(category || "").trim().toLowerCase();

	if (
		normalized.includes("att") ||
		normalized.includes("forward") ||
		normalized.includes("striker")
	) {
		return "Att";
	}

	if (normalized.includes("mid") || normalized.includes("wing") || normalized.includes("cm")) {
		return "Mid";
	}

	// Keep strict 3 buckets: map GK/keeper-like values to Def as requested.
	if (
		normalized.includes("def") ||
		normalized.includes("back") ||
		normalized.includes("gk") ||
		normalized.includes("goalkeeper") ||
		normalized.includes("keeper")
	) {
		return "Def";
	}

	// Unknown values fallback to the closest conservative bucket.
	return "Def";
}

// Helper function to count remaining players by category
function getCountRemainingByCategory() {
	const unsoldPoolNames = unsoldPool.map((p) => String(p.name).toLowerCase());
	const remainingPlayers = players.filter(
		(p) => !p.isSold && !unsoldPoolNames.includes(String(p.name).toLowerCase())
	);

	const counts = {
		Att: remainingPlayers.filter((p) => normalizeCategoryToShortForm(p.category) === "Att").length,
		Mid: remainingPlayers.filter((p) => normalizeCategoryToShortForm(p.category) === "Mid").length,
		Def: remainingPlayers.filter((p) => normalizeCategoryToShortForm(p.category) === "Def").length,
	};

	const totalRemaining = remainingPlayers.length;

	return { counts, totalRemaining };
}

app.post("/upload", upload.single("file"), (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: "No file uploaded" });
		}

		// Get captain names from request body to exclude them
		const captainNames = req.body?.captains || [];
		const normalizedCaptains = captainNames.map((name) =>
			String(name).trim().toLowerCase()
		);

		const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
		const firstSheetName = workbook.SheetNames[0];

		if (!firstSheetName) {
			return res.status(400).json({ error: "Workbook has no sheets" });
		}

		const firstSheet = workbook.Sheets[firstSheetName];
		const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: "" });

		players.length = 0;
		unsoldPool.length = 0;

		for (const row of rows) {
			const name = getValueByHeader(row, ["name", "playername"]);
			const category = getValueByHeader(row, ["category", "cat"]);
			const position = getValueByHeader(row, ["position", "role"]);
			const avgRating = Number(row.AvgRating || 0);
			const rawLastMatchRating = row["LastMatchRating"] || row["lastMatchRating"] || 0;
			const lastMatchRating = (() => {
				if (rawLastMatchRating === null || rawLastMatchRating === undefined || rawLastMatchRating === "") {
					return 0;
				}

				const parsed = Number(rawLastMatchRating);
				return Number.isNaN(parsed) ? String(rawLastMatchRating).trim() : parsed;
			})();
			const lastMatchStats = row["Last Match Stats"] || row["lastmatchstats"] || "No stats available";

			if (!name || !category || !position) {
				continue;
			}

			// Skip captain players
			if (normalizedCaptains.includes(String(name).trim().toLowerCase())) {
				continue;
			}

			players.push({
				name: String(name).trim(),
				category: normalizeCategoryToShortForm(category),
				position: String(position).trim(),
				avgRating: Number.isNaN(avgRating) ? 0 : avgRating,
				lastMatchRating,
				lastMatchStats: String(lastMatchStats).trim(),
				isSold: false,
			});
		}

		console.log("Sample Player Data:", players[0]);

		return res.json({
			message: "Players uploaded successfully",
			totalPlayers: players.length,
			players,
			...getCountRemainingByCategory(),
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Upload failed" });
	}
});

app.get("/draw", (req, res) => {
	const { category } = req.query;

	// Use unsoldPool if playerPool is empty, otherwise use playerPool
	const unsoldPlayers = players.filter((player) => !player.isSold);
	const poolToUse = unsoldPlayers.length > 0 ? unsoldPlayers : unsoldPool;

	if (poolToUse.length === 0) {
		return res.status(404).json({ error: "No unsold players available" });
	}

	const requestedCategory = category ? normalizeCategoryToShortForm(category) : "";
	const filteredPool = requestedCategory
		? poolToUse.filter(
				(player) => normalizeCategoryToShortForm(player.category) === requestedCategory
		  )
		: poolToUse;

	console.log(`[/draw] Requested category: '${requestedCategory}', Filtered pool size: ${filteredPool.length}`);

	if (filteredPool.length === 0) {
		return res.status(404).json({
			error: `No unsold players available for category '${category}'`,
		});
	}

	const randomIndex = Math.floor(Math.random() * filteredPool.length);
	const randomPlayer = filteredPool[randomIndex];

	// Get counts of remaining players by category
	const { counts, totalRemaining } = getCountRemainingByCategory();

	return res.json({
		player: randomPlayer,
		currentBid: 0,
		lastBidder: null,
		counts,
		totalRemaining,
	});
});

app.post("/sold", (req, res) => {
	const { name, timerExpired } = req.body || {};

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

	// If timer expired, add to unsoldPool (player was not sold in time)
	if (timerExpired) {
		unsoldPool.push(player);
	}

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
	const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});
