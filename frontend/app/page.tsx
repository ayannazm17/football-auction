"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bebas_Neue, Manrope } from "next/font/google";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const displayFont = Bebas_Neue({
	subsets: ["latin"],
	weight: "400",
});

const bodyFont = Manrope({
	subsets: ["latin"],
	weight: ["400", "500", "700", "800"],
});

type Player = {
	name: string;
	category: string;
	position: string;
	avgRating: number;
	lastMatchRating?: number | string;
	lastMatchStats?: string;
	isSold: boolean;
	soldPrice?: number;
};

type SoldHistoryEntry = {
	id: string;
	playerName: string;
	price: number;
	captainName: string;
	captainSide: CaptainSide;
	timestamp: string;
};

type CaptainSide = "captain1" | "captain2";
type PositionFilter = "Att" | "Mid" | "Def";
const REQUIRED_SQUAD_SIZE = 11;
const FINAL_SQUAD_SIZE = 12;
const AUCTION_STORAGE_KEY = "auction_state_v1";

export default function Home() {
	const [captain1Name, setCaptain1Name] = useState("Captain 1");
	const [captain2Name, setCaptain2Name] = useState("Captain 2");
	const [captain1Budget, setCaptain1Budget] = useState(100);
	const [captain2Budget, setCaptain2Budget] = useState(100);
	const [captain1Roster, setCaptain1Roster] = useState<Player[]>([]);
	const [captain2Roster, setCaptain2Roster] = useState<Player[]>([]);
	const [playerPool, setPlayerPool] = useState<Player[]>([]);
	const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
	const [currentBid, setCurrentBid] = useState(0);
	const [lastBidder, setLastBidder] = useState<string | null>(null);
	const [lastBidderSide, setLastBidderSide] = useState<CaptainSide | null>(null);
	const [isLastBidderHighlighted, setIsLastBidderHighlighted] = useState(false);
	const [selectedPosition, setSelectedPosition] = useState<PositionFilter>("Att");
	const [uploading, setUploading] = useState(false);
	const [isFileUploaded, setIsFileUploaded] = useState(false);
	const [drawing, setDrawing] = useState(false);
	const [selling, setSelling] = useState(false);
	const [statusMessage, setStatusMessage] = useState("Upload an Excel sheet to begin the auction.");
	const [historyLog, setHistoryLog] = useState<SoldHistoryEntry[]>([]);
	const [unsoldPlayers, setUnsoldPlayers] = useState<Player[]>([]);
	const [isStateHydrated, setIsStateHydrated] = useState(false);
	const [timeRemaining, setTimeRemaining] = useState(10);
	const [timerActive, setTimerActive] = useState(false);
	const [previousPlayer, setPreviousPlayer] = useState<Player | null>(null);
	const [timerIntervalRef, setTimerIntervalRef] = useState<NodeJS.Timeout | null>(null);
	const gavelAudio = useRef<HTMLAudioElement | null>(
		typeof Audio !== "undefined" ? new Audio("/gavel.mp3") : null
	);
 	const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const countFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const timerExtendFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [isCountFlashActive, setIsCountFlashActive] = useState(false);
	const [isTimerExtendFlashActive, setIsTimerExtendFlashActive] = useState(false);
	const [bidTimestamps, setBidTimestamps] = useState<number[]>([]);
	const [isFinalScreenOpen, setIsFinalScreenOpen] = useState(false);

	const roundedBid = useMemo(() => Number(currentBid.toFixed(1)), [currentBid]);

	const remainingCounts = useMemo<Record<PositionFilter, number>>(() => {
		const unavailableNames = new Set(
			[...captain1Roster, ...captain2Roster, ...unsoldPlayers].map((p) =>
				String(p.name).trim().toLowerCase()
			)
		);

		const counts: Record<PositionFilter, number> = { Att: 0, Mid: 0, Def: 0 };

		for (const player of playerPool) {
			const playerName = String(player.name).trim().toLowerCase();
			if (unavailableNames.has(playerName)) {
				continue;
			}

			const category = toThreeCategory(player.category);
			counts[category] += 1;
		}

		return counts;
	}, [playerPool, captain1Roster, captain2Roster, unsoldPlayers]);

	const availablePlayersForAuction = useMemo(() => {
		const unavailableNames = new Set(
			[...captain1Roster, ...captain2Roster, ...unsoldPlayers].map((p) =>
				String(p.name).trim().toLowerCase()
			)
		);

		return playerPool.filter((player) => {
			const normalizedName = String(player.name).trim().toLowerCase();
			return !player.isSold && !unavailableNames.has(normalizedName);
		});
	}, [playerPool, captain1Roster, captain2Roster, unsoldPlayers]);

	const hasAuctionActivity =
		historyLog.length > 0 || captain1Roster.length > 0 || captain2Roster.length > 0;
	const isAuctionFinished =
		hasAuctionActivity &&
		(playerPool.length === 0 || availablePlayersForAuction.length === 0) &&
		!currentPlayer;
	const sortedCaptain1FinalRoster = useMemo(() => sortRoster(captain1Roster), [captain1Roster]);
	const sortedCaptain2FinalRoster = useMemo(() => sortRoster(captain2Roster), [captain2Roster]);

	const captain1Summary = useMemo(() => {
		const totalSpent = captain1Roster.reduce((sum, player) => sum + (player.soldPrice ?? 0), 0);
		const avgRatingPerPlayer =
			captain1Roster.length > 0
				? captain1Roster.reduce((sum, player) => sum + Number(player.avgRating || 0), 0) /
				  captain1Roster.length
				: 0;
		const topBuy =
			captain1Roster.length > 0
				? captain1Roster.reduce((top, player) =>
					(player.soldPrice ?? 0) > (top.soldPrice ?? 0) ? player : top
				)
				: null;

		return {
			totalSpent: Number(totalSpent.toFixed(1)),
			avgRatingPerPlayer: Number(avgRatingPerPlayer.toFixed(2)),
			topBuy,
		};
	}, [captain1Roster]);

	const captain2Summary = useMemo(() => {
		const totalSpent = captain2Roster.reduce((sum, player) => sum + (player.soldPrice ?? 0), 0);
		const avgRatingPerPlayer =
			captain2Roster.length > 0
				? captain2Roster.reduce((sum, player) => sum + Number(player.avgRating || 0), 0) /
				  captain2Roster.length
				: 0;
		const topBuy =
			captain2Roster.length > 0
				? captain2Roster.reduce((top, player) =>
					(player.soldPrice ?? 0) > (top.soldPrice ?? 0) ? player : top
				)
				: null;

		return {
			totalSpent: Number(totalSpent.toFixed(1)),
			avgRatingPerPlayer: Number(avgRatingPerPlayer.toFixed(2)),
			topBuy,
		};
	}, [captain2Roster]);

	const canStartTimer = Boolean(currentPlayer) && !timerActive && !selling;
	const isHotBidding =
		bidTimestamps.length >= 4 &&
		bidTimestamps[bidTimestamps.length - 1] - bidTimestamps[bidTimestamps.length - 4] <= 10_000;

	function playGavel() {
		try {
			if (!gavelAudio.current) {
				return;
			}

			gavelAudio.current.currentTime = 0;
			void gavelAudio.current.play().catch(() => {
				// Ignore autoplay restrictions or missing audio file.
			});
		} catch {
			// Never block auction flow if audio cannot initialize.
		}
	}

	function playBlip() {
		try {
			const audio = new Audio("/blip.mp3");
			audio.currentTime = 0;
			void audio.play().catch(() => {
				// Ignore autoplay restrictions or missing file.
			});
		} catch {
			// Never block auction flow for optional cue.
		}
	}

	function normalizePlayerCategory(player: Player): Player {
		return {
			...player,
			category: toThreeCategory(player.category || player.position),
		};
	}

	async function downloadSquad(captainId: CaptainSide) {
		if (typeof window === "undefined") {
			return;
		}

		const targetId = captainId === "captain1" ? "captain-1-card" : "captain-2-card";
		const target = document.getElementById(targetId);

		if (!target) {
			setStatusMessage("Unable to capture squad panel right now.");
			return;
		}

		try {
			const canvas = await html2canvas(target, {
				backgroundColor: null,
				scale: 2,
				useCORS: true,
				allowTaint: true,
				logging: true,
			});

			const imageUrl = canvas.toDataURL("image/png");
			const link = document.createElement("a");
			const squadName = captainId === "captain1" ? captain1Name : captain2Name;
			link.href = imageUrl;
			link.download = `${squadName.replace(/\s+/g, "_")}_Squad.png`;
			link.click();
			setStatusMessage(`Downloaded ${squadName} squad card.`);
		} catch (err) {
			console.error("Canvas Error:", err);
			setStatusMessage("Could not download squad card. Please try again.");
		}
	}

	useEffect(() => {
		try {
			const raw = localStorage.getItem(AUCTION_STORAGE_KEY);
			if (!raw) {
				setIsStateHydrated(true);
				return;
			}

			const parsed = JSON.parse(raw) as {
				playerPool?: Player[];
				isFileUploaded?: boolean;
				captain1?: { name?: string; budget?: number; roster?: Player[] };
				captain2?: { name?: string; budget?: number; roster?: Player[] };
				unsoldPlayers?: Player[];
				history?: SoldHistoryEntry[];
			};

			if (Array.isArray(parsed.playerPool)) {
				setPlayerPool(parsed.playerPool);
			}
			setIsFileUploaded(
				typeof parsed.isFileUploaded === "boolean"
					? parsed.isFileUploaded
					: Array.isArray(parsed.playerPool) && parsed.playerPool.length > 0
			);

			if (parsed.captain1) {
				setCaptain1Name(parsed.captain1.name || "Captain 1");
				setCaptain1Budget(typeof parsed.captain1.budget === "number" ? parsed.captain1.budget : 100);
				setCaptain1Roster(Array.isArray(parsed.captain1.roster) ? parsed.captain1.roster : []);
			}

			if (parsed.captain2) {
				setCaptain2Name(parsed.captain2.name || "Captain 2");
				setCaptain2Budget(typeof parsed.captain2.budget === "number" ? parsed.captain2.budget : 100);
				setCaptain2Roster(Array.isArray(parsed.captain2.roster) ? parsed.captain2.roster : []);
			}

			setUnsoldPlayers(Array.isArray(parsed.unsoldPlayers) ? parsed.unsoldPlayers : []);
			setHistoryLog(
				Array.isArray(parsed.history)
					? parsed.history.map((item: any, index: number) => ({
						id: String(item?.id || `${item?.playerName || "player"}-${Date.now()}-${index}`),
						playerName: String(item?.playerName || "Unknown"),
						price: Number(item?.price || 0),
						captainName: String(item?.captainName || item?.buyer || "Unknown"),
						captainSide: item?.captainSide === "captain2" ? "captain2" : "captain1",
						timestamp: String(item?.timestamp || new Date().toISOString()),
					}))
					: []
			);
		} catch {
			// Ignore malformed localStorage and continue with defaults.
		} finally {
			setIsStateHydrated(true);
		}
	}, []);

	useEffect(() => {
		if (!isStateHydrated) {
			return;
		}

		const persistableState = {
			playerPool,
			isFileUploaded,
			captain1: {
				name: captain1Name,
				budget: captain1Budget,
				roster: captain1Roster,
			},
			captain2: {
				name: captain2Name,
				budget: captain2Budget,
				roster: captain2Roster,
			},
			unsoldPlayers,
			history: historyLog,
		};

		localStorage.setItem(AUCTION_STORAGE_KEY, JSON.stringify(persistableState));
	}, [
		isStateHydrated,
		playerPool,
		isFileUploaded,
		captain1Name,
		captain1Budget,
		captain1Roster,
		captain2Name,
		captain2Budget,
		captain2Roster,
		unsoldPlayers,
		historyLog,
	]);

	useEffect(() => {
		if (gavelAudio.current) {
			gavelAudio.current.preload = "auto";
			gavelAudio.current.load();
		}

		return () => {
			if (highlightTimeoutRef.current) {
				clearTimeout(highlightTimeoutRef.current);
			}
			if (countFlashTimeoutRef.current) {
				clearTimeout(countFlashTimeoutRef.current);
			}
			if (timerExtendFlashTimeoutRef.current) {
				clearTimeout(timerExtendFlashTimeoutRef.current);
			}
			if (timerIntervalRef) {
				clearInterval(timerIntervalRef);
			}
		};
	}, [timerIntervalRef]);

	function triggerTimerExtendFlash() {
		setIsTimerExtendFlashActive(true);

		if (timerExtendFlashTimeoutRef.current) {
			clearTimeout(timerExtendFlashTimeoutRef.current);
		}

		timerExtendFlashTimeoutRef.current = setTimeout(() => {
			setIsTimerExtendFlashActive(false);
		}, 550);
	}

	function triggerCountFlash() {
		setIsCountFlashActive(true);

		if (countFlashTimeoutRef.current) {
			clearTimeout(countFlashTimeoutRef.current);
		}

		countFlashTimeoutRef.current = setTimeout(() => {
			setIsCountFlashActive(false);
		}, 650);
	}

	// Counts are derived reactively via useMemo from playerPool + roster/unsold state.

	// Handle timer countdown
	useEffect(() => {
		if (!timerActive || !currentPlayer) {
			return;
		}

		if (timerIntervalRef) {
			clearInterval(timerIntervalRef);
		}

		const interval = setInterval(() => {
			setTimeRemaining((prev) => {
				const newTime = prev - 1;

				if (newTime <= 0) {
					// Timer expired - if no bid was made, move to unsold
					if (!lastBidder) {
						handleTimerExpired();
					}
					setTimerActive(false);
					return 10;
				}

				return newTime;
			});
		}, 1000);

		setTimerIntervalRef(interval);

		return () => clearInterval(interval);
	}, [timerActive, currentPlayer, lastBidder]);

	function triggerLastBidderHighlight() {
		setIsLastBidderHighlighted(false);

		if (highlightTimeoutRef.current) {
			clearTimeout(highlightTimeoutRef.current);
		}

		requestAnimationFrame(() => {
			setIsLastBidderHighlighted(true);
		});

		highlightTimeoutRef.current = setTimeout(() => {
			setIsLastBidderHighlighted(false);
		}, 700);
	}

	async function handleTimerExpired() {
		if (!currentPlayer) return;

		try {
			const response = await fetch(`${API_URL}/sold`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: currentPlayer.name, timerExpired: true }),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Failed to mark player as unsold");
			}

			// Add to unsold list
			setUnsoldPlayers((prev) => [...prev, normalizePlayerCategory(currentPlayer)]);
			setStatusMessage(`${currentPlayer.name} returned to unsold pool (timer expired).`);
			setCurrentPlayer(null);
			setCurrentBid(0);
			setLastBidder(null);
			setLastBidderSide(null);
			setPreviousPlayer(null);
		} catch (error) {
			setStatusMessage(error instanceof Error ? error.message : "Failed to mark unsold");
		}
	}

	function handleUndoPlayer() {
		if (!previousPlayer) {
			setStatusMessage("No previous player to return to.");
			return;
		}

		setCurrentPlayer(previousPlayer);
		setPreviousPlayer(null);
		setCurrentBid(0);
		setLastBidder(null);
		setLastBidderSide(null);
		setTimeRemaining(10);
		setTimerActive(false);
		setBidTimestamps([]);
		setStatusMessage("Returned to previous player.");
	}

	function handleResetAuction() {
		setCaptain1Name("Captain 1");
		setCaptain2Name("Captain 2");
		setCaptain1Budget(100);
		setCaptain2Budget(100);
		setCaptain1Roster([]);
		setCaptain2Roster([]);
		setPlayerPool([]);
		setIsFileUploaded(false);
		setCurrentPlayer(null);
		setCurrentBid(0);
		setLastBidder(null);
		setLastBidderSide(null);
		setHistoryLog([]);
		setUnsoldPlayers([]);
		setBidTimestamps([]);
		setIsFinalScreenOpen(false);
		setTimeRemaining(10);
		setTimerActive(false);
		setPreviousPlayer(null);
		localStorage.removeItem(AUCTION_STORAGE_KEY);
		if (timerIntervalRef) clearInterval(timerIntervalRef);
		setStatusMessage("Auction reset. Upload an Excel sheet to start a fresh match.");
	}

	function handleUndoHistoryEntry(entryId: string) {
		const entry = historyLog.find((item) => item.id === entryId);
		if (!entry) {
			return;
		}

		const targetPlayerName = entry.playerName.trim().toLowerCase();

		if (entry.captainSide === "captain1") {
			setCaptain1Roster((prev) =>
				prev.filter((player) => player.name.trim().toLowerCase() !== targetPlayerName)
			);
			setCaptain1Budget((prev) => Number((prev + entry.price).toFixed(1)));
		} else {
			setCaptain2Roster((prev) =>
				prev.filter((player) => player.name.trim().toLowerCase() !== targetPlayerName)
			);
			setCaptain2Budget((prev) => Number((prev + entry.price).toFixed(1)));
		}

		setPlayerPool((prev) =>
			prev.map((player) => {
				if (player.name.trim().toLowerCase() !== targetPlayerName) {
					return player;
				}

				return {
					...player,
					isSold: false,
					soldPrice: undefined,
				};
			})
		);

		setHistoryLog((prev) => prev.filter((item) => item.id !== entryId));
		setStatusMessage(`Undid sale for ${entry.playerName}. Budget refunded to ${entry.captainName}.`);
		triggerCountFlash();
	}

	async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];

		if (!file) {
			return;
		}

		setUploading(true);
		setIsFileUploaded(false);
		setStatusMessage("Uploading players...");

		try {
			const formData = new FormData();
			formData.append("file", file);

			const response = await fetch(`${API_URL}/upload`, {
				method: "POST",
				body: formData,
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Upload failed");
			}

			setCurrentPlayer(null);
			setCurrentBid(0);
			setLastBidder(null);
			setLastBidderSide(null);
			setCaptain1Budget(100);
			setCaptain2Budget(100);
			setCaptain1Roster([]);
			setCaptain2Roster([]);
			setPlayerPool(
				Array.isArray(data.players)
					? data.players.map((player: Player) => normalizePlayerCategory(player))
					: []
			);
			setIsFileUploaded(true);
			setHistoryLog([]);
			setUnsoldPlayers([]);
			setBidTimestamps([]);
			setIsFinalScreenOpen(false);
			setPreviousPlayer(null);
			setTimerActive(false);
			setTimeRemaining(10);
			setStatusMessage(`Uploaded ${data.totalPlayers ?? 0} players successfully.`);
		} catch (error) {
			setStatusMessage(error instanceof Error ? error.message : "Upload failed");
		} finally {
			setUploading(false);
			event.target.value = "";
		}
	}

	async function handleDrawPlayer(position?: PositionFilter) {
		setDrawing(true);
		setStatusMessage(position ? `Drawing an unsold ${position} player...` : "Drawing a random unsold player...");

		try {
			const query = position ? `?category=${encodeURIComponent(position)}` : "";
			const response = await fetch(`${API_URL}/draw${query}`);
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Unable to draw player");
			}

			// Handle new format payload
			const player = normalizePlayerCategory(data.player || data);

			// Save current player as previous before drawing new one
			if (currentPlayer) {
				setPreviousPlayer(currentPlayer);
			}

			setCurrentPlayer(player);
			setCurrentBid(typeof data.currentBid === "number" ? data.currentBid : 0);
			setLastBidder(null);
			setLastBidderSide(null);
			setBidTimestamps([]);
			setTimeRemaining(10);
			setTimerActive(false);
			setStatusMessage(`${player.name} is on the board. Click 'Start Timer' to begin the countdown!`);
		} catch (error) {
			setStatusMessage(error instanceof Error ? error.message : "Unable to draw player");
		} finally {
			setDrawing(false);
		}
	}

	function handleBid(side: CaptainSide) {
		if (!currentPlayer) {
			setStatusMessage("Draw a player before bidding.");
			return;
		}

		const bidderName = side === "captain1" ? captain1Name : captain2Name;
		const bidderBudget = side === "captain1" ? captain1Budget : captain2Budget;
		const nextBid = roundedBid === 0 ? 1 : Number((roundedBid + 0.5).toFixed(1));

		if (bidderBudget < nextBid) {
			setStatusMessage(`${bidderName} cannot bid ${nextBid.toFixed(1)} due to insufficient balance.`);
			return;
		}

		setCurrentBid(nextBid);
		setLastBidder(bidderName);
		setLastBidderSide(side);
		setBidTimestamps((prev) => [...prev.slice(-3), Date.now()]);
		triggerLastBidderHighlight();

		if (roundedBid === 0) {
			setTimeRemaining(10);
			setTimerActive(true);
			setStatusMessage(`${bidderName} opened at 1.0. Timer started at 10s.`);
			return;
		}

		setTimeRemaining(20);
		setTimerActive(true);
		triggerTimerExtendFlash();
		playBlip();
		setStatusMessage(`${bidderName} raised the bid to ${nextBid.toFixed(1)}. Timer extended to 20s.`);
	}

	function handleReduceBid() {
		if (!lastBidder) {
			setStatusMessage("No bids placed yet.");
			return;
		}

		const newBid = Number((roundedBid - 0.5).toFixed(1));

		if (newBid < 1) {
			setStatusMessage("Bid cannot be less than 1.0.");
			return;
		}

		setCurrentBid(newBid);
		setStatusMessage(`Bid reduced to ${newBid.toFixed(1)}.`);
	}

	function handleStartTimer() {
		if (!currentPlayer) {
			setStatusMessage("Draw a player before starting the timer.");
			return;
		}

		if (timerActive) {
			setStatusMessage("Timer is already running.");
			return;
		}

		setTimerActive(true);
		setTimeRemaining(10);
		setStatusMessage("Timer started! 10 seconds to first bid.");
	}

	function handleExportToExcel(captainName: string, roster: Player[]) {
		if (roster.length === 0) {
			setStatusMessage(`${captainName}'s squad is empty. Nothing to export.`);
			return;
		}

		const sortedRoster = sortRoster(roster);

		// Prepare data for export
		const exportData = sortedRoster.map((player) => ({
			Name: player.name,
			Position: toShortForm(player.position),
			"Price Paid": player.soldPrice ?? 0,
			"Last Match Stats": player.lastMatchStats || "N/A",
		}));

		// Create workbook and worksheet
		const worksheet = XLSX.utils.json_to_sheet(exportData);
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, worksheet, "Squad");

		// Style the header row
		const headerRange = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
		for (let C = headerRange.s.c; C <= headerRange.e.c; ++C) {
			const address = XLSX.utils.encode_col(C) + "1";
			if (!worksheet[address]) continue;
			worksheet[address].s = {
				font: { bold: true, color: { rgb: "FFFFFF" } },
				fill: { fgColor: { rgb: "366092" } },
				alignment: { horizontal: "center", vertical: "center" },
			};
		}

		// Auto-fit column widths
		const colWidths = [
			{ wch: 25 }, // Name
			{ wch: 12 }, // Position
			{ wch: 12 }, // Price Paid
			{ wch: 25 }, // Last Match Stats
		];
		worksheet["!cols"] = colWidths;

		// Generate filename with captain name and timestamp
		const timestamp = new Date().toLocaleDateString("en-IN").replace(/\//g, "-");
		const filename = `${captainName.replace(/\s+/g, "_")}_Squad_${timestamp}.xlsx`;

		// Trigger download
		XLSX.writeFile(workbook, filename);
		setStatusMessage(`Exported ${captainName}'s squad to ${filename}`);
	}

	async function handleSold() {
		playGavel();

		if (!currentPlayer) {
			setStatusMessage("Draw a player before marking sold.");
			return;
		}

		if (!lastBidder || !lastBidderSide) {
			setStatusMessage("Place at least one bid before marking this player as sold.");
			return;
		}

		const buyerName = lastBidder;
		const budget = lastBidderSide === "captain1" ? captain1Budget : captain2Budget;

		if (budget < roundedBid) {
			setStatusMessage(`${buyerName} does not have enough budget for this bid.`);
			return;
		}

		setSelling(true);

		try {
			const response = await fetch(`${API_URL}/sold`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: currentPlayer.name }),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Failed to mark player as sold");
			}

			const soldPlayer = {
				...normalizePlayerCategory(currentPlayer),
				isSold: true,
				soldPrice: roundedBid,
			};
			const isFinalSale = availablePlayersForAuction.length === 1;

			if (lastBidderSide === "captain1") {
				setCaptain1Budget((prev) => Number((prev - roundedBid).toFixed(1)));
				setCaptain1Roster((prev) => [...prev, soldPlayer]);
			} else {
				setCaptain2Budget((prev) => Number((prev - roundedBid).toFixed(1)));
				setCaptain2Roster((prev) => [...prev, soldPlayer]);
			}

			setPlayerPool((prev) =>
				prev.map((player) => {
					if (player.name.trim().toLowerCase() !== currentPlayer.name.trim().toLowerCase()) {
						return player;
					}

					return {
						...player,
						category: toThreeCategory(player.category || player.position),
						isSold: true,
						soldPrice: roundedBid,
					};
				})
			);

			setHistoryLog((prev) => [
				...prev,
				{
					id: `${currentPlayer.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					playerName: currentPlayer.name,
					price: roundedBid,
					captainName: buyerName,
					captainSide: lastBidderSide,
					timestamp: new Date().toISOString(),
				},
			]);

			setStatusMessage(`${currentPlayer.name} sold to ${buyerName} for ${roundedBid.toFixed(1)}.`);
			triggerCountFlash();
			if (isFinalSale) {
				setIsFinalScreenOpen(true);
			}
			setCurrentPlayer(null);
			setCurrentBid(0);
			setLastBidder(null);
			setLastBidderSide(null);
			setBidTimestamps([]);
			setIsLastBidderHighlighted(false);
		} catch (error) {
			setStatusMessage(error instanceof Error ? error.message : "Failed to mark sold");
		} finally {
			setSelling(false);
		}
	}

	return (
		<main
			className={`${bodyFont.className} min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 text-slate-900`}
		>
			<div className="mx-auto w-full">
				{/* TOP SECTION: Player Spotlight Banner */}
			<section className="sticky top-0 z-40 w-full border-b-4 border-yellow-400 bg-slate-900 px-4 py-3 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-7xl">
					{/* Total Players Remaining Counter */}
					<div className="mb-4 flex items-center justify-between rounded-lg border border-cyan-400/50 bg-cyan-900/20 px-3 py-2">
						<p className="text-xs font-bold uppercase tracking-[0.15em] text-cyan-300">Total Remaining</p>
						<p
							className={`${displayFont.className} text-lg font-extrabold text-cyan-200 transition-all duration-500 ${
								isCountFlashActive ? "scale-110 text-emerald-300" : "scale-100"
							}`}
						>
							{remainingCounts.Att + remainingCounts.Mid + remainingCounts.Def}
						</p>
					</div>
						{currentPlayer ? (
							<div className="flex items-center justify-between gap-4">
								<div className="flex-1">
									<p className={`${displayFont.className} text-4xl font-extrabold tracking-wide text-yellow-400 sm:text-5xl`}>
										{currentPlayer.name}
									</p>
									{currentPlayer.lastMatchStats &&
										String(currentPlayer.lastMatchStats).trim() !== "" &&
										String(currentPlayer.lastMatchStats).trim().toLowerCase() !== "no stats available" && (
											<p className="mt-2 text-sm italic text-gray-300">
												Last Match Stats: {currentPlayer.lastMatchStats}
											</p>
										)}
									<div className="mt-3 flex flex-wrap gap-4 text-lg font-semibold text-yellow-200">
										<span>Position: {toShortForm(currentPlayer.position)}</span>
										<span>Category: {toShortForm(currentPlayer.category)}</span>
										<span>Avg Rating: {currentPlayer.avgRating}</span>
										<span>
											Last Match Rating: {currentPlayer.lastMatchRating !== undefined ? currentPlayer.lastMatchRating : "N/A"}
										</span>
									</div>
								</div>
								{currentPlayer && (
									<div
										className={`rounded-2xl px-6 py-4 text-center ${
											timeRemaining <= 3
												? "bg-red-500/30 border-2 border-red-400"
												: "bg-emerald-500/20 border-2 border-emerald-400"
										}`}
									>
										<p className="text-sm font-bold text-yellow-200">Time Remaining</p>
										<p
											className={`${displayFont.className} mt-2 text-4xl font-extrabold transition-all duration-500 ${
												timeRemaining <= 3 ? "text-red-300" : "text-emerald-300"
											} ${isTimerExtendFlashActive ? "scale-110 animate-pulse" : "scale-100"}`}
										>
											{timeRemaining}s
										</p>
									</div>
								)}
							</div>
						) : (
							<div className="text-center">
								<p className={`${displayFont.className} text-3xl font-extrabold text-yellow-400`}>NO PLAYER SELECTED</p>
								<p className="mt-2 text-yellow-200">Draw a player to begin the auction</p>
							</div>
						)}
					</div>
				</section>

				{/* MIDDLE SECTION: 3-Grid Battleground */}
				<section className="w-full px-4 py-8 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						<div className="grid grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-[minmax(300px,1fr)_minmax(420px,1.15fr)_minmax(300px,1fr)]">
							{/* LEFT COLUMN: Captain 1 */}
							<BattlegroundPanel
								captainName={captain1Name}
								onCaptainNameChange={setCaptain1Name}
								budget={captain1Budget}
								roster={captain1Roster}
								requiredSquadSize={REQUIRED_SQUAD_SIZE}
								tone="left"
								cardId="captain-1-card"
								onExport={() => handleExportToExcel(captain1Name, captain1Roster)}
								onDownloadSquad={() => downloadSquad("captain1")}
							/>

							{/* CENTER COLUMN: Bidding Dashboard */}
							<div className="flex flex-col rounded-3xl border-2 border-slate-900 bg-gradient-to-b from-slate-800 to-slate-900 p-6 text-white shadow-2xl">
								<h2 className={`${displayFont.className} text-center text-3xl tracking-wide text-cyan-300`}>Bidding Arena</h2>

								{/* Current Bid Section */}
								<div className="mt-6 rounded-2xl border-2 border-emerald-400 bg-emerald-900/20 p-4">
									<p className="text-center text-sm font-bold uppercase tracking-wider text-emerald-300">
										Current Bid {isHotBidding ? "🔥 HOT" : ""}
									</p>
									<p className={`${displayFont.className} mt-3 text-center text-6xl font-extrabold text-emerald-400`}>
										{roundedBid.toFixed(1)}
									</p>
								</div>

								{/* Last Bidder Section */}
								<div className="mt-6 rounded-2xl border-2 border-amber-400 bg-amber-900/20 p-4">
									<p className="text-center text-sm font-bold uppercase tracking-wider text-amber-300">Last Bidder</p>
									<p
										className={`${displayFont.className} mt-3 text-center text-3xl font-extrabold transition-all duration-300 sm:text-4xl ${
											isLastBidderHighlighted
												? "scale-110 text-amber-200 drop-shadow-[0_0_14px_rgba(252,211,77,0.8)]"
												: "scale-100 text-white"
										}`}
									>
										{lastBidder || "No bids yet"}
									</p>
								</div>
							{/* Start Timer Button */}
							<button
								onClick={handleStartTimer}
								disabled={!canStartTimer || !isFileUploaded}
								title={!isFileUploaded ? "Please upload roster first" : undefined}
								className="mt-6 w-full rounded-xl bg-gradient-to-r from-lime-500 to-green-500 px-4 py-3 text-lg font-extrabold uppercase tracking-wide text-white transition hover:from-lime-400 hover:to-green-400 disabled:cursor-not-allowed disabled:opacity-60"
							>
								Start Timer
							</button>
								{/* Bid Control Buttons */}
								<div className="mt-6 space-y-3">
									<div className="grid grid-cols-2 gap-3">
										<button
											onClick={() => handleBid("captain1")}
											disabled={!currentPlayer || selling || !isFileUploaded}
											title={!isFileUploaded ? "Please upload roster first" : undefined}
											className="rounded-xl bg-sky-500 px-3 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
										>
											{captain1Name} +0.5
										</button>
										<button
											onClick={() => handleBid("captain2")}
											disabled={!currentPlayer || selling || !isFileUploaded}
											title={!isFileUploaded ? "Please upload roster first" : undefined}
											className="rounded-xl bg-orange-500 px-3 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
										>
											{captain2Name} +0.5
										</button>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<button
											onClick={handleReduceBid}
											disabled={!lastBidder || selling}
											className="rounded-xl bg-amber-600 px-3 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
										>
											Reduce -0.5
										</button>
										<button
											onClick={handleUndoPlayer}
											disabled={!previousPlayer || selling}
											className="rounded-xl bg-indigo-600 px-3 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
										>
											Back
										</button>
									</div>
								</div>

								{/* Sold Button */}
								<button
									onClick={handleSold}
									disabled={selling || !currentPlayer || !lastBidderSide}
									className="mt-6 w-full rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 px-4 py-4 text-lg font-extrabold uppercase tracking-wide text-white transition hover:from-violet-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{lastBidder ? `Sold to ${lastBidder}` : "Mark as Sold"}
								</button>

								{/* Status Message */}
								<div className="mt-6 rounded-xl border border-slate-600 bg-slate-800/50 px-3 py-3">
									<p className="text-center text-sm text-slate-300">{statusMessage}</p>
								</div>

								{(isAuctionFinished || hasAuctionActivity) && (
									<button
										onClick={() => setIsFinalScreenOpen(true)}
										className="mt-4 w-full rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition hover:from-cyan-500 hover:to-blue-500"
									>
										View Final Squads
									</button>
								)}
							</div>

							{/* RIGHT COLUMN: Captain 2 */}
							<BattlegroundPanel
								captainName={captain2Name}
								onCaptainNameChange={setCaptain2Name}
								budget={captain2Budget}
								roster={captain2Roster}
								requiredSquadSize={REQUIRED_SQUAD_SIZE}
								tone="right"
								cardId="captain-2-card"
								onExport={() => handleExportToExcel(captain2Name, captain2Roster)}
								onDownloadSquad={() => downloadSquad("captain2")}
							/>
						</div>
					</div>
				</section>

				{/* BOTTOM SECTION: Unsold Players */}
				<section className="w-full border-t-2 border-slate-300 bg-white px-4 py-6 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						<h3 className={`${displayFont.className} text-2xl tracking-wide text-slate-900`}>Unsold Players</h3>
						<p className="mt-1 text-sm text-slate-600">Players who timed out and returned to the pool</p>

						<div className="mt-4 flex flex-wrap gap-2">
							{unsoldPlayers.length === 0 ? (
								<p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
									No unsold players
								</p>
							) : (
								unsoldPlayers.map((player, index) => (
									<span
										key={`${player.name}-${index}`}
										className="inline-block rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900"
									>
										{player.name}
									</span>
								))
							)}
						</div>
					</div>
				</section>

				{/* FOOTER PANE: Title, History, and Controls */}
				<section className="w-full border-t-4 border-slate-900 bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-8 text-white sm:px-6 lg:px-8">
					<div className="mx-auto max-w-7xl">
						{/* Title and Upload Controls */}
						<div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
							<div>
								<h1 className={`${displayFont.className} text-4xl font-extrabold tracking-wide text-yellow-400 sm:text-5xl`}>
									Football Auction Dashboard
								</h1>
								<p className="mt-1 text-sm text-slate-300">Live bidding, tracking, and squad management</p>
							</div>
							<div className="flex gap-3">
								<label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-white">
									{uploading ? "Uploading..." : "Upload Excel"}
									<input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading} className="hidden" />
								</label>
								<button
									onClick={handleResetAuction}
									disabled={uploading || drawing || selling}
									className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
								>
									Reset Auction
								</button>

							</div>
						</div>

						{/* Draw Controls */}
						<div className="mb-8 flex flex-col gap-3 rounded-2xl border border-slate-600 bg-slate-900/50 p-4">
							{!isFileUploaded && (
								<p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300">
									Please upload roster first
								</p>
							)}
							<div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
								<p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">Draw Player</p>
								<div
									className={`hidden items-center justify-end gap-2 font-mono text-xs font-bold transition-all duration-500 sm:flex ${
										isCountFlashActive ? "text-lime-300" : "text-emerald-300"
									}`}
								>
										<span>Remaining: Att {remainingCounts.Att} | Mid {remainingCounts.Mid} | Def {remainingCounts.Def}</span>
								</div>
							</div>
							<div className="sm:hidden">
									<p
										className={`text-center font-mono text-xs font-bold transition-colors duration-500 ${
											isCountFlashActive ? "text-lime-300" : "text-emerald-300"
										}`}
									>
										Remaining: Att {remainingCounts.Att} | Mid {remainingCounts.Mid} | Def {remainingCounts.Def}
								</p>
							</div>
							<div className="flex flex-col gap-3 sm:flex-row">
								<button
									onClick={() => handleDrawPlayer()}
									disabled={drawing || uploading || !isFileUploaded}
									title={!isFileUploaded ? "Please upload roster first" : undefined}
									className="flex-1 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{drawing
										? "Drawing..."
										: `Draw Random (${remainingCounts.Att + remainingCounts.Mid + remainingCounts.Def} left)`}
								</button>
								<select
									value={selectedPosition}
									onChange={(event) => setSelectedPosition(event.target.value as PositionFilter)}
									className="rounded-xl border border-slate-500 bg-slate-700 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
								>
									<option value="Att">Attacker (Att) - {remainingCounts.Att} left</option>
									<option value="Mid">Midfielder (Mid) - {remainingCounts.Mid} left</option>
									<option value="Def">Defender (Def) - {remainingCounts.Def} left</option>
								</select>
								<button
									onClick={() => handleDrawPlayer(selectedPosition)}
									disabled={drawing || uploading || !isFileUploaded}
									title={!isFileUploaded ? "Please upload roster first" : undefined}
									className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
								>
									Draw by Position ({selectedPosition}: {remainingCounts[selectedPosition]} left)
								</button>
								<button
									onClick={handleUndoPlayer}
									disabled={!previousPlayer || timerActive}
									className="flex-1 rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
								>
									Back to Previous
								</button>
							</div>
						</div>

						{/* History Log */}
						<div>
							<h3 className={`${displayFont.className} text-2xl tracking-wide text-yellow-400`}>Transaction History</h3>
							<p className="mt-1 text-sm text-slate-300">All completed sales</p>

							<div className="mt-4 max-h-48 space-y-2 overflow-auto pr-1">
								{historyLog.length === 0 ? (
									<p className="rounded-lg border border-dashed border-slate-600 bg-slate-900/40 px-3 py-3 text-sm text-slate-400">
										No sales yet
									</p>
								) : (
									historyLog.map((entry, index) => (
										<div key={entry.id || `${entry.playerName}-${index}`} className="rounded-lg border border-slate-600 bg-slate-900/40 px-4 py-2">
											<p className="text-sm font-bold text-yellow-300">{entry.playerName}</p>
											<p className="text-xs text-slate-400">
												Sold to <span className="text-cyan-300">{entry.captainName}</span> for{" "}
												<span className="font-bold text-emerald-300">{entry.price.toFixed(1)}</span>
											</p>
											<p className="text-[11px] text-slate-500">
												{new Date(entry.timestamp).toLocaleString("en-IN")}
											</p>
											<button
												onClick={() => handleUndoHistoryEntry(entry.id)}
												className="mt-2 rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white transition hover:bg-rose-500"
											>
												Delete/Undo
											</button>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				</section>
			</div>

			{isFinalScreenOpen && (
				<div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/95 px-4 py-6 backdrop-blur-sm sm:px-8">
					<div className="mx-auto max-w-7xl rounded-3xl border border-cyan-400/40 bg-slate-900 p-6 text-white shadow-2xl sm:p-8">
						<div className="mb-4 flex items-start justify-between">
							<div>
								<h2 className={`${displayFont.className} text-4xl tracking-wide text-cyan-300 sm:text-5xl`}>
									Final Squad Overview
								</h2>
								<p className="mt-1 text-sm text-slate-300">Sorted by category: Att, Mid, Def</p>
							</div>
							<button
								onClick={() => setIsFinalScreenOpen(false)}
								className="rounded-xl bg-slate-700 px-4 py-2 text-2xl font-extrabold leading-none text-white transition hover:bg-slate-600"
								aria-label="Close final squads"
							>
								X
							</button>
						</div>

						<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
							<div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
								<h3 className={`${displayFont.className} text-3xl text-cyan-300`}>{captain1Name}</h3>
								<p className="mt-2 text-sm text-slate-300">Total Expenditure: {captain1Summary.totalSpent.toFixed(1)}</p>
								<p className="text-sm text-slate-300">Remaining Budget: {captain1Budget.toFixed(1)}</p>
								<p className="text-sm text-slate-300">Squad: {captain1Roster.length}/{FINAL_SQUAD_SIZE}</p>

								<div className="mt-4 space-y-2">
									{Array.from({ length: FINAL_SQUAD_SIZE }, (_, index) => {
										const player = sortedCaptain1FinalRoster[index];
										if (!player) {
											return (
												<div
													key={`c1-empty-${index}`}
													className="rounded-lg border border-dashed border-slate-600 bg-slate-900/40 px-3 py-2 text-sm text-slate-400"
												>
													Slot {index + 1}: Empty
												</div>
											);
										}

										return (
											<div key={`c1-${player.name}-${index}`} className="rounded-lg border border-slate-600 bg-slate-900/50 px-3 py-2">
												<p className="text-sm font-bold text-white">{player.name}</p>
												<p className="text-xs text-slate-300">{toThreeCategory(player.category || player.position)} • {(player.soldPrice ?? 0).toFixed(1)}</p>
											</div>
										);
									})}
								</div>
							</div>

							<div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
								<h3 className={`${displayFont.className} text-3xl text-cyan-300`}>{captain2Name}</h3>
								<p className="mt-2 text-sm text-slate-300">Total Expenditure: {captain2Summary.totalSpent.toFixed(1)}</p>
								<p className="text-sm text-slate-300">Remaining Budget: {captain2Budget.toFixed(1)}</p>
								<p className="text-sm text-slate-300">Squad: {captain2Roster.length}/{FINAL_SQUAD_SIZE}</p>

								<div className="mt-4 space-y-2">
									{Array.from({ length: FINAL_SQUAD_SIZE }, (_, index) => {
										const player = sortedCaptain2FinalRoster[index];
										if (!player) {
											return (
												<div
													key={`c2-empty-${index}`}
													className="rounded-lg border border-dashed border-slate-600 bg-slate-900/40 px-3 py-2 text-sm text-slate-400"
												>
													Slot {index + 1}: Empty
												</div>
											);
										}

										return (
											<div key={`c2-${player.name}-${index}`} className="rounded-lg border border-slate-600 bg-slate-900/50 px-3 py-2">
												<p className="text-sm font-bold text-white">{player.name}</p>
												<p className="text-xs text-slate-300">{toThreeCategory(player.category || player.position)} • {(player.soldPrice ?? 0).toFixed(1)}</p>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}

function BattlegroundPanel({
	captainName,
	onCaptainNameChange,
	budget,
	roster,
	requiredSquadSize,
	tone,
	cardId,
	onExport,
	onDownloadSquad,
}: {
	captainName: string;
	onCaptainNameChange: (name: string) => void;
	budget: number;
	roster: Player[];
	requiredSquadSize: number;
	tone: "left" | "right";
	cardId: string;
	onExport: () => void;
	onDownloadSquad: () => void;
}) {
	const isLeft = tone === "left";
	const bgColor = isLeft ? "bg-white" : "bg-black";
	const textColor = isLeft ? "text-black" : "text-white";
	const borderColor = isLeft ? "border-slate-300" : "border-slate-700";
	const inputBg = isLeft ? "bg-white text-black border-slate-300" : "bg-slate-800 text-white border-slate-600";
	const labelColor = isLeft ? "text-slate-600" : "text-slate-400";
	const playersNeeded = Math.max(0, requiredSquadSize - roster.length);
	const isLowBudgetWarning = budget < 10 && playersNeeded >= 5;
	const sortedRoster = sortRoster(roster);
	const rosterWithPurchaseNumber = roster.map((player, index) => ({
		player,
		purchaseNumber: index + 1,
	}));

	const squadCounts = getSquadCounts(sortedRoster);

	const attPlayers = rosterWithPurchaseNumber.filter(
		(entry) => toThreeCategory(entry.player.category || entry.player.position) === "Att"
	);
	const midPlayers = rosterWithPurchaseNumber.filter(
		(entry) => toThreeCategory(entry.player.category || entry.player.position) === "Mid"
	);
	const defPlayers = rosterWithPurchaseNumber.filter(
		(entry) => toThreeCategory(entry.player.category || entry.player.position) === "Def"
	);

	function renderPitchDots(
		categoryPlayers: Array<{ player: Player; purchaseNumber: number }>,
		category: PositionFilter
	) {
		const colorClass =
			category === "Att"
				? "bg-red-500 ring-red-200/90"
				: category === "Mid"
					? "bg-green-500 ring-green-200/90"
					: "bg-blue-500 ring-blue-200/90";

		const topBase = category === "Att" ? 10 : category === "Mid" ? 38 : 68;

		return categoryPlayers.map((entry, index) => (
			<div
				key={`${category}-${entry.player.name}-${entry.purchaseNumber}-${index}`}
				className={`absolute flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ${colorClass}`}
				style={{
					top: `${Math.min(topBase + 18, topBase + Math.floor(index / 3) * 9)}%`,
					left: `${(index % 3) * 30 + 10}%`,
				}}
				title={`${entry.player.name} (#${entry.purchaseNumber})`}
			>
				{entry.purchaseNumber}
			</div>
		));
	}

	const pitchSection = (
		<div className={`flex w-full flex-shrink-0 flex-col rounded-lg border ${borderColor} p-2 md:w-40 md:self-stretch`}>
			<p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${labelColor}`}>Mini Pitch</p>
			<div className="relative mt-2 h-72 w-full overflow-hidden rounded-md border border-white/80 bg-gradient-to-b from-green-800 to-green-900 md:h-full md:min-h-[420px]">
				<div className="absolute left-0 top-1/2 h-[1px] w-full -translate-y-1/2 bg-white/80" />
				<div className="absolute left-1/2 top-0 h-full w-[1px] -translate-x-1/2 bg-white/25" />
				<div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50" />

				{renderPitchDots(attPlayers, "Att")}
				{renderPitchDots(midPlayers, "Mid")}
				{renderPitchDots(defPlayers, "Def")}
			</div>
		</div>
	);

	const squadListSection = (
		<div className={`flex-1 rounded-lg border ${borderColor} px-3 py-3`}>
			<div className="flex items-center justify-between gap-2">
				<p className={`text-xs font-bold uppercase tracking-[0.15em] ${labelColor}`}>Squad ({roster.length})</p>
				{roster.length > 0 && (
					<button
						onClick={onExport}
						className={`rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide transition ${
							isLeft
								? "bg-teal-500 text-white hover:bg-teal-600"
								: "bg-teal-600 text-white hover:bg-teal-500"
						}`}
					>
						Export
					</button>
				)}
			</div>

			<div className="mt-2 max-h-[420px] space-y-1 overflow-y-auto pr-1">
				{sortedRoster.length === 0 ? (
					<p
						className={`rounded-lg border border-dashed ${borderColor} px-2 py-2 text-xs ${
							isLeft ? "bg-slate-50 text-slate-500" : "bg-slate-900/40 text-slate-400"
						}`}
					>
						No players yet
					</p>
				) : (
					sortedRoster.map((player, index) => (
						<div
							key={`${player.name}-${player.position}-${index}`}
							className={`rounded-lg border ${borderColor} px-2 py-2 text-xs ${
								isLeft ? "bg-slate-50 text-slate-900" : "bg-slate-900/50 text-white"
							}`}
						>
							<p className="font-bold">{player.name}</p>
							<p className={isLeft ? "text-slate-600" : "text-slate-400"}>
								{toShortForm(player.position)}
							</p>
							<p className={`pt-1 font-semibold ${isLeft ? "text-teal-600" : "text-teal-400"}`}>
								{(player.soldPrice ?? 0).toFixed(1)}
							</p>
						</div>
					))
				)}
			</div>
		</div>
	);

	return (
		<aside
			id={cardId}
			className={`flex h-full w-full flex-col rounded-2xl border-2 ${borderColor} ${bgColor} ${textColor} shadow-lg`}
		>
			<div className={`flex flex-1 flex-col gap-4 p-3 md:flex-row md:items-stretch ${isLeft ? "" : "md:flex-row-reverse"}`}>
				{pitchSection}

				<div className={`flex min-w-0 flex-1 flex-col rounded-lg border ${borderColor} shadow-sm`}>
					{/* Captain Name Input */}
					<div className={`border-b ${borderColor} px-4 py-4`}>
						<p className={`text-xs font-bold uppercase tracking-[0.15em] ${labelColor}`}>Captain</p>
						<input
							value={captainName}
							onChange={(event) => onCaptainNameChange(event.target.value)}
							className={`mt-2 w-full rounded-lg border ${inputBg} px-3 py-2 font-bold outline-none transition focus:ring-2 focus:ring-teal-500/20`}
							placeholder="Captain Name"
						/>
					</div>

					{/* Budget Display */}
					<div className={`border-b ${borderColor} px-4 py-3`}>
						<p className={`text-xs font-bold uppercase tracking-[0.15em] ${labelColor}`}>Remaining Budget</p>
						<p
							className={`mt-1 text-2xl font-extrabold ${
								isLowBudgetWarning
									? "animate-pulse text-red-600"
									: isLeft
										? "text-teal-600"
										: "text-teal-400"
							}`}
						>
							{budget.toFixed(1)}
						</p>
						<p className={`mt-1 text-[11px] ${labelColor}`}>
							Need {playersNeeded} more to reach squad size {requiredSquadSize}
						</p>
					</div>

					{/* Position Stats */}
					<div className={`border-b ${borderColor} px-4 py-3`}>
						<p className={`text-xs font-bold uppercase tracking-[0.15em] ${labelColor}`}>Squad Stats</p>
						<div className="mt-2 grid grid-cols-3 gap-1 text-center">
							<div>
								<p className="text-xs font-bold">Att</p>
								<p className={isLeft ? "text-lg font-extrabold text-slate-900" : "text-lg font-extrabold text-white"}>
									{squadCounts.Att}
								</p>
							</div>
							<div>
								<p className="text-xs font-bold">Mid</p>
								<p className={isLeft ? "text-lg font-extrabold text-slate-900" : "text-lg font-extrabold text-white"}>
									{squadCounts.Mid}
								</p>
							</div>
							<div>
								<p className="text-xs font-bold">Def</p>
								<p className={isLeft ? "text-lg font-extrabold text-slate-900" : "text-lg font-extrabold text-white"}>
									{squadCounts.Def}
								</p>
							</div>
						</div>
					</div>

					<div className={`flex-1 border-b ${borderColor} px-4 py-3`}>{squadListSection}</div>

					<div className={`px-4 py-3`}>
						<button
							onClick={onDownloadSquad}
							className={`w-full rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
								isLeft
									? "bg-slate-900 text-white hover:bg-slate-700"
									: "bg-slate-100 text-slate-900 hover:bg-white"
							}`}
						>
							Download Squad
						</button>
					</div>
				</div>
			</div>
		</aside>
	);
}

function toShortForm(value: string) {
	const normalized = String(value || "").trim().toLowerCase();

	if (["att", "attacker", "forward", "striker"].includes(normalized)) {
		return "Att";
	}

	if (["mid", "midfielder", "mid field", "midfield"].includes(normalized)) {
		return "Mid";
	}

	if (["def", "defender", "defence", "defense"].includes(normalized)) {
		return "Def";
	}

	if (["gk", "goalkeeper", "keeper"].includes(normalized)) {
		return "GK";
	}

	return value;
}

function toThreeCategory(value: string): PositionFilter {
	const short = toShortForm(value);

	if (short === "Att") {
		return "Att";
	}

	if (short === "Mid") {
		return "Mid";
	}

	return "Def";
}

function getSquadCounts(roster: Player[]) {
	return {
		Att: roster.filter((player) => toThreeCategory(player.category || player.position) === "Att").length,
		Mid: roster.filter((player) => toThreeCategory(player.category || player.position) === "Mid").length,
		Def: roster.filter((player) => toThreeCategory(player.category || player.position) === "Def").length,
	};
}

function sortRoster(roster: Player[]) {
	const categoryPriority: Record<PositionFilter, number> = {
		Att: 0,
		Mid: 1,
		Def: 2,
	};

	return [...roster].sort((a, b) => {
		const aPriority = categoryPriority[toThreeCategory(a.category || a.position)];
		const bPriority = categoryPriority[toThreeCategory(b.category || b.position)];

		if (aPriority !== bPriority) {
			return aPriority - bPriority;
		}

		return a.name.localeCompare(b.name);
	});
}
