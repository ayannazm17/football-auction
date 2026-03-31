require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const xlsx = require("xlsx");

console.log("--- BACKEND DEBUG ---");
console.log("Looking for key in:", process.cwd());
console.log("Is ADMIN_SECRET_KEY defined?", !!process.env.ADMIN_SECRET_KEY);
console.log("----------------------");

const allowedOrigins = [
	"http://localhost:3000",
	"https://football-auction-kohl.vercel.app",
	process.env.FRONTEND_URL,
].filter(Boolean);

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
const DEFAULT_TEAM_BUDGET = 100;
let players = [];
const bidderTeams = {};

app.disable("x-powered-by");
app.use(helmet());

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
});
app.use(apiLimiter);

app.use(
	cors({
		origin(origin, callback) {
			if (!origin) {
				return callback(null, true);
			}

			if (!allowedOrigins.includes(origin)) {
				return callback(
					new Error("The CORS policy for this site does not allow access from the specified Origin."),
					false
				);
			}

			return callback(null, true);
		},
		methods: ["GET", "POST"],
		credentials: true,
	})
);
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

	if (normalized.includes("att") || normalized.includes("forward") || normalized.includes("striker")) {
		return "Att";
	}

	if (normalized.includes("mid") || normalized.includes("wing") || normalized.includes("cm")) {
		return "Mid";
	}

	if (
		normalized.includes("def") ||
		normalized.includes("back") ||
		normalized.includes("gk") ||
		normalized.includes("goalkeeper") ||
		normalized.includes("keeper")
	) {
		return "Def";
	}

	return "Def";
}

function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toClientPlayer(playerDoc) {
	return {
		id: String(playerDoc.id || playerDoc._id || ""),
		name: playerDoc.Name,
		category: normalizeCategoryToShortForm(playerDoc.Category),
		position: String(playerDoc.Position || "").trim(),
		price: Number(playerDoc.Price || 0),
		avgRating: Number(playerDoc.Rating || 0),
		image: playerDoc.Image || "",
		imageFilename: playerDoc.Image || "",
		lastMatchStats: playerDoc.Stats || "No stats available",
		stats: playerDoc.Stats || "No stats available",
		matchesPlayed: playerDoc.MatchesPlayed ?? "N/A",
		lastMatchRating: playerDoc.LastMatchRating ?? 0,
		isSold: Boolean(playerDoc.IsSold),
		soldPrice: Number(playerDoc.SoldPrice || 0),
		soldTo: playerDoc.SoldTo || "",
	};
}

function getOrCreateTeam(teamName) {
	const normalizedTeamName = String(teamName || "").trim();
	if (!normalizedTeamName) {
		return null;
	}

	if (!bidderTeams[normalizedTeamName]) {
		bidderTeams[normalizedTeamName] = {
			budget: DEFAULT_TEAM_BUDGET,
			squad: [],
		};
	}

	return bidderTeams[normalizedTeamName];
}

function serializeTeams() {
	const teams = {};

	for (const [teamName, teamData] of Object.entries(bidderTeams)) {
		const squad = Array.isArray(teamData.squad) ? teamData.squad : [];
		const totalSpent = squad.reduce((sum, player) => sum + Number(player.soldPrice || 0), 0);

		teams[teamName] = {
			budget: Number(Number(teamData.budget || 0).toFixed(1)),
			totalSpent: Number(totalSpent.toFixed(1)),
			totalPlayers: squad.length,
			squad,
		};
	}

	return teams;
}

function getAvailablePlayerPool() {
	return players.filter((player) => !player.IsSold).map(toClientPlayer);
}

async function getCountRemainingByCategory() {
	const att = players.filter((player) => !player.IsSold && player.Category === "Att").length;
	const mid = players.filter((player) => !player.IsSold && player.Category === "Mid").length;
	const def = players.filter((player) => !player.IsSold && player.Category === "Def").length;

	return {
		counts: {
			Att: att,
			Mid: mid,
			Def: def,
		},
		totalRemaining: att + mid + def,
	};
}

function toFinalReportPlayer(playerDoc) {
	return {
		"Player Name": playerDoc.Name,
		Category: normalizeCategoryToShortForm(playerDoc.Category),
		Position: String(playerDoc.Position || "").trim(),
		Rating: Number(playerDoc.Rating || 0),
		"Matches Played": playerDoc.MatchesPlayed ?? "N/A",
	};
}

app.post("/upload", verifyAdmin, upload.single("file"), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: "No file uploaded" });
		}

		const rawCaptains = req.body?.captains;
		const normalizedCaptains = (
			typeof rawCaptains === "string"
				? rawCaptains.split(",")
				: Array.isArray(rawCaptains)
					? rawCaptains
					: []
		)
			.map((name) => String(name).trim().toLowerCase())
			.filter((name) => name.length > 0);

		const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
		const firstSheetName = workbook.SheetNames[0];

		if (!firstSheetName) {
			return res.status(400).json({ error: "Workbook has no sheets" });
		}

		const firstSheet = workbook.Sheets[firstSheetName];
		const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: "" });

		const docsToInsert = [];
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
			const image = getValueByHeader(row, ["image", "imagefilename", "photo", "avatar", "picture"]);
			const rawPrice = getValueByHeader(row, ["price", "baseprice", "cost"]);
			const parsedPrice = Number(rawPrice || 0);

			if (!name || !category || !position) {
				continue;
			}

			if (normalizedCaptains.includes(String(name).trim().toLowerCase())) {
				continue;
			}

			docsToInsert.push({
				Name: String(name).trim(),
				Category: normalizeCategoryToShortForm(category),
				Position: String(position).trim(),
				Price: Number.isNaN(parsedPrice) ? 0 : parsedPrice,
				Rating: Number.isNaN(avgRating) ? 0 : avgRating,
				Image: String(image || "").trim(),
				Stats: String(lastMatchStats).trim(),
				MatchesPlayed: matchesPlayed,
				LastMatchRating: lastMatchRating,
				IsSold: false,
				SoldTo: "",
				SoldPrice: 0,
			});
		}

		players = docsToInsert
			.map((player, index) => ({
				...player,
				id: `${Date.now()}-${index}`,
			}))
			.sort((a, b) => a.Name.localeCompare(b.Name));

		for (const key of Object.keys(bidderTeams)) {
			delete bidderTeams[key];
		}

		const allPlayers = players;
		const { counts, totalRemaining } = await getCountRemainingByCategory();

		return res.json({
			message: "Players uploaded successfully",
			totalPlayers: allPlayers.length,
			players: allPlayers.map(toClientPlayer),
			counts,
			totalRemaining,
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Upload failed" });
	}
});

app.get("/players", async (req, res) => {
	try {
		return res.json(players);
	} catch (error) {
		return res.status(500).json({ error: error.message || "Failed to fetch players" });
	}
});

app.get("/final-squad-report", verifyAdmin, async (req, res) => {
	try {
		const soldPlayers = players
			.filter((player) => player.IsSold && String(player.SoldTo || "").trim() !== "")
			.sort((a, b) => a.Name.localeCompare(b.Name));
		return res.json({
			totalPlayers: soldPlayers.length,
			report: soldPlayers.map(toFinalReportPlayer),
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Failed to fetch final report" });
	}
});

app.get("/draw", async (req, res) => {
	try {
		const { category } = req.query;
		const normalizedCategory = category ? normalizeCategoryToShortForm(category) : null;
		const poolToUse = players.filter((player) => {
			if (player.IsSold) {
				return false;
			}

			if (normalizedCategory && player.Category !== normalizedCategory) {
				return false;
			}

			return true;
		});

		if (poolToUse.length === 0) {
			return res.status(404).json({ error: "No unsold players available" });
		}

		const randomIndex = Math.floor(Math.random() * poolToUse.length);
		const randomPlayer = poolToUse[randomIndex];
		const { counts, totalRemaining } = await getCountRemainingByCategory();

		return res.json({
			player: toClientPlayer(randomPlayer),
			currentBid: 0,
			lastBidder: null,
			counts,
			totalRemaining,
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Draw failed" });
	}
});

app.post("/sold", verifyAdmin, async (req, res) => {
	try {
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

		const normalizedInputName = String(name).trim().toLowerCase();
		const player = players.find(
			(item) => String(item.Name).trim().toLowerCase() === normalizedInputName
		);
		if (!player) {
			return res.status(404).json({ error: "Player not found" });
		}

		if (player.IsSold) {
			return res.status(400).json({ error: "Player is already sold" });
		}

		player.IsSold = true;

		if (hasBidderSale) {
			const teamName = String(bidderName).trim();
			const numericAmount = Number(amount);
			const soldAmount = Number.isNaN(numericAmount) ? 0 : numericAmount;
			const team = getOrCreateTeam(teamName);

			player.SoldTo = teamName;
			player.SoldPrice = soldAmount;
			player.Price = soldAmount;

			if (!team) {
				return res.status(400).json({ error: "Invalid bidder team name" });
			}

			team.budget = Number((Number(team.budget || 0) - soldAmount).toFixed(1));
			team.squad.push(toClientPlayer(player));
		}

		return res.json({
			message: "Player marked as sold",
			player: toClientPlayer(player),
			timerExpired: isTimerExpired,
			movedToUnsoldPool: isTimerExpired && !hasBidderSale,
			savedToBidderTeam: hasBidderSale ? String(bidderName).trim() : null,
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Failed to mark sold" });
	}
});

app.post("/undo-sold", verifyAdmin, async (req, res) => {
	try {
		const playerNameInput = req.body?.playerName ?? req.body?.name;
		const teamNameInput = req.body?.teamName ?? req.body?.bidderName;

		if (!playerNameInput) {
			return res.status(400).json({ error: "playerName is required" });
		}

		const normalizedPlayerName = String(playerNameInput).trim().toLowerCase();
		const playerDoc = players.find(
			(player) => String(player.Name).trim().toLowerCase() === normalizedPlayerName
		);

		if (!playerDoc) {
			return res.status(404).json({ error: "Player not found" });
		}

		if (!playerDoc.IsSold) {
			return res.status(400).json({ error: "Player is not currently sold" });
		}

		const resolvedTeamName = String(teamNameInput || playerDoc.SoldTo || "").trim();
		if (!resolvedTeamName) {
			return res.status(400).json({ error: "teamName is required" });
		}

		const team = bidderTeams[resolvedTeamName];
		if (!team || !Array.isArray(team.squad)) {
			return res.status(404).json({ error: "Team not found" });
		}

		const squadIndex = team.squad.findIndex(
			(player) => String(player.name).trim().toLowerCase() === normalizedPlayerName
		);

		if (squadIndex === -1) {
			return res.status(404).json({ error: "Player not found in the specified team's squad" });
		}

		const [removedPlayer] = team.squad.splice(squadIndex, 1);
		const refundAmount = Number(removedPlayer?.soldPrice ?? playerDoc.SoldPrice ?? 0);
		team.budget = Number((Number(team.budget || 0) + refundAmount).toFixed(1));

		playerDoc.IsSold = false;
		playerDoc.SoldTo = "";
		playerDoc.SoldPrice = 0;

		return res.json({
			message: "Sold player moved back to available pool",
			teams: serializeTeams(),
			playerPool: getAvailablePlayerPool(),
			player: toClientPlayer(playerDoc),
			refunded: {
				teamName: resolvedTeamName,
				amount: Number(refundAmount.toFixed(1)),
			},
		});
	} catch (error) {
		return res.status(500).json({ error: error.message || "Failed to undo sold player" });
	}
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

async function startServer() {
	try {
		app.listen(PORT, "0.0.0.0", () => {
			console.log("process.env.ADMIN_SECRET_KEY:", process.env.ADMIN_SECRET_KEY);
			console.log(`Server running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Failed to start server:", error.message || error);
		process.exit(1);
	}
}

void startServer();
