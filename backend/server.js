require('dotenv').config();
console.log("--- BACKEND DEBUG ---");
console.log("Looking for key in:", process.cwd());
console.log("Is ADMIN_SECRET_KEY defined?", !!process.env.ADMIN_SECRET_KEY);
console.log("----------------------");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const xlsx = require("xlsx");
const allowedOrigins = [
	"http://localhost:3000",
	"https://football-auction-kohl.vercel.app",
	process.env.FRONTEND_URL,
].filter(Boolean);

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;

app.disable("x-powered-by");
app.use(helmet());

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
});
app.use(apiLimiter);

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

function verifyAdmin(req, res, next) {
	if (!ADMIN_SECRET_KEY) {
		return res.status(500).json({ error: "Missing ADMIN_SECRET_KEY in backend .env file" });
	}

	const providedKey = req.headers["x-admin-key"];
	if (!providedKey || providedKey !== ADMIN_SECRET_KEY) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	return next();
}

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 5 * 1024 * 1024,
	},
	fileFilter: (req, file, cb) => {
		const allowedMimeTypes = [
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.ms-excel",
		];

		const isExcelByExt = /\.(xlsx|xls)$/i.test(file.originalname || "");
		const isExcelByMime = allowedMimeTypes.includes(file.mimetype);

		if (isExcelByExt && isExcelByMime) {
			cb(null, true);
			return;
		}

		cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
	},
});

const players = [];
const unsoldPool = [];
const bidderTeams = {};

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

function parseNumericOrText(value, fallbackValue = "N/A") {
	if (value === null || value === undefined || value === "") {
		return fallbackValue;
	}

	const parsed = Number(value);
	if (!Number.isNaN(parsed)) {
		return parsed;
	}

	const text = String(value).trim();
	return text === "" ? fallbackValue : text;
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

function toFinalReportPlayer(player) {
	return {
		"Player Name": player.name,
		Category: normalizeCategoryToShortForm(player.category),
		Position: String(player.position || "").trim(),
		Rating: Number(player.avgRating || 0),
		"Matches Played": player.matchesPlayed ?? "N/A",
	};
}

app.post("/upload", verifyAdmin, upload.single("file"), (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: "No file uploaded" });
		}

		// FormData can send captains as a comma-separated string; normalize to array.
		const rawCaptains = req.body?.captains;
		const captainNames = Array.isArray(rawCaptains)
			? rawCaptains
			: typeof rawCaptains === "string"
				? rawCaptains.split(",")
				: [];
		const normalizedCaptains = captainNames
			.map((name) => String(name).trim().toLowerCase())
			.filter((name) => name.length > 0);

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
			const rawAvgRating = getValueByHeader(row, ["avgrating", "rating", "avg"]);
			const avgRating = Number(rawAvgRating || 0);
			const rawMatchesPlayed = getValueByHeader(row, ["matchesplayed", "matches", "mp"]);
			const matchesPlayed = parseNumericOrText(rawMatchesPlayed);
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
				matchesPlayed,
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

app.get("/final-squad-report", verifyAdmin, (req, res) => {
	const soldPlayers = players.filter((player) => player.isSold);

	return res.json({
		totalPlayers: soldPlayers.length,
		report: soldPlayers.map(toFinalReportPlayer),
	});
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

app.post("/sold", verifyAdmin, (req, res) => {
	const { name, timerExpired, bidderName, amount } = req.body || {};
	const isTimerExpired =
		timerExpired === true ||
		timerExpired === "true" ||
		timerExpired === 1 ||
		timerExpired === "1";
	const hasBidderSale =
		bidderName !== undefined &&
		bidderName !== null &&
		String(bidderName).trim() !== "" &&
		amount !== undefined &&
		amount !== null &&
		amount !== "";

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

	if (hasBidderSale) {
		const teamName = String(bidderName).trim();
		const numericAmount = Number(amount);
		const soldAmount = Number.isNaN(numericAmount) ? 0 : numericAmount;

		if (!bidderTeams[teamName]) {
			bidderTeams[teamName] = [];
		}

		const soldRecord = {
			...player,
			soldTo: teamName,
			soldPrice: soldAmount,
		};

		bidderTeams[teamName].push(soldRecord);
		player.soldTo = teamName;
		player.soldPrice = soldAmount;
	}

	// If timer expired, add to unsoldPool (player was not sold in time)
	if (isTimerExpired && !hasBidderSale) {
		unsoldPool.push(player);
	}

	return res.json({
		message: "Player marked as sold",
		player,
		timerExpired: isTimerExpired,
		movedToUnsoldPool: isTimerExpired && !hasBidderSale,
		savedToBidderTeam: hasBidderSale ? String(bidderName).trim() : null,
	});
});

app.use((error, req, res, next) => {
	if (error instanceof multer.MulterError) {
		if (error.code === "LIMIT_FILE_SIZE") {
			return res.status(413).json({ error: "File too large. Maximum allowed size is 5MB" });
		}

		return res.status(400).json({ error: error.message });
	}

	if (error) {
		return res.status(400).json({ error: error.message || "Request failed" });
	}

	return next();
});


app.listen(PORT, '0.0.0.0', () => {
	console.log("process.env.ADMIN_SECRET_KEY:", process.env.ADMIN_SECRET_KEY);
	console.log(`Server running on port ${PORT}`);
});