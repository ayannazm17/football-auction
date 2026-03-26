"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bebas_Neue, Manrope } from "next/font/google";
import confetti from 'canvas-confetti';
import * as XLSX from 'xlsx';

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
	matchesPlayed?: number | string;
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

type GalleryPlayer = {
	name: string;
	position: string;
	category: string;
	imageFilename?: string;
	image?: string;
};

type CaptainSide = "captain1" | "captain2";
type PositionFilter = "Att" | "Mid" | "Def";
type AppTab = "landing" | "auction" | "gallery";
const REQUIRED_SQUAD_SIZE = 11;
const FINAL_SQUAD_SIZE = 12;
const AUCTION_STORAGE_KEY = "auction_state_v1";

export default function Home() {
	const [isAuthorized, setIsAuthorized] = useState(false);
	const [adminKey, setAdminKey] = useState("");
	const [loginError, setLoginError] = useState("");
	const [captain1Name, setCaptain1Name] = useState("Captain 1");
	const [captain2Name, setCaptain2Name] = useState("Captain 2");
	const [captainsInput, setCaptainsInput] = useState("");
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
	const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const gavelAudioRef = useRef<HTMLAudioElement | null>(
		typeof Audio !== "undefined" ? new Audio("/gavel.mp3") : null
	);
	const celebrationAudioRef = useRef<HTMLAudioElement | null>(
		typeof Audio !== "undefined" ? new Audio("/celebration.mp3") : null
	);
	const tickTickAudio = useRef<HTMLAudioElement | null>(
		typeof Audio !== "undefined" ? new Audio("/tick.mp3") : null
	);
 	const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const countFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const timerExtendFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [isCountFlashActive, setIsCountFlashActive] = useState(false);
	const [isTimerExtendFlashActive, setIsTimerExtendFlashActive] = useState(false);
	const [bidTimestamps, setBidTimestamps] = useState<number[]>([]);
	const [isFinalScreenOpen, setIsFinalScreenOpen] = useState(false);
	const [isRemainingPoolOpen, setIsRemainingPoolOpen] = useState(false);
	const [remainingSearch, setRemainingSearch] = useState("");
	const [activeTab, setActiveTab] = useState<AppTab>("landing");
	const timerExpiryInFlightRef = useRef(false);
	const audioCtxRef = useRef<AudioContext | null>(null);

	useEffect(() => {
		console.log("NEXT_PUBLIC_ADMIN_SECRET_KEY:", process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY);
	}, []);

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

	const remainingPlayers = useMemo(() => {
		const currentPlayerName = currentPlayer?.name.trim().toLowerCase();

		return playerPool.filter((player) => {
			const playerName = player.name.trim().toLowerCase();
			const isInBiddingWindow = Boolean(currentPlayerName) && playerName === currentPlayerName;

			return !player.isSold && !isInBiddingWindow;
		});
	}, [playerPool, currentPlayer]);

	const filteredRemainingPlayers = useMemo(() => {
		const query = remainingSearch.trim().toLowerCase();
		if (!query) {
			return remainingPlayers;
		}

		return remainingPlayers.filter((player) => {
			const name = player.name.toLowerCase();
			const position = String(player.position || "").toLowerCase();
			return name.includes(query) || position.includes(query);
		});
	}, [remainingPlayers, remainingSearch]);

	const groupedRemainingPlayers = useMemo(() => {
		const groups: Record<PositionFilter, Player[]> = { Att: [], Mid: [], Def: [] };

		for (const player of filteredRemainingPlayers) {
			groups[toThreeCategory(player.category || player.position)].push(player);
		}

		return groups;
	}, [filteredRemainingPlayers]);

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

	function handleLogin() {
		if (process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY === undefined) {
			console.log("NEXT_PUBLIC_ADMIN_SECRET_KEY is missing entirely.");
			alert("Environment Variable Missing");
			setIsAuthorized(false);
			setLoginError("Incorrect Password. Access Denied.");
			return;
		}

		const enteredPassword = adminKey.trim();
		const expectedPassword = process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY.trim();

		if (enteredPassword === expectedPassword) {
			setIsAuthorized(true);
			setLoginError("");
			return;
		}

		setIsAuthorized(false);
		setLoginError("Incorrect Password. Access Denied.");
	}

	function stopCelebrationAudio() {
		if (!celebrationAudioRef.current) {
			return;
		}

		celebrationAudioRef.current.pause();
		celebrationAudioRef.current.currentTime = 0;
	}

	function playSoldAudioSequence() {
		try {
			const gavel = gavelAudioRef.current;
			if (!gavel) {
				return;
			}
			const celebration = celebrationAudioRef.current;

			stopCelebrationAudio();
			gavel.pause();
			gavel.currentTime = 0;
			gavel.onended = () => {
				if (!celebration) {
					gavel.onended = null;
					return;
				}

				const confettiColors = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#A855F7"];
				void confetti({
					particleCount: 150,
					spread: 70,
					angle: 60,
					origin: { x: 0.1, y: 1 },
					colors: confettiColors,
				});
				void confetti({
					particleCount: 150,
					spread: 70,
					angle: 120,
					origin: { x: 0.9, y: 1 },
					colors: confettiColors,
				});

				celebration.volume = 1.0;
				console.log("Attempting to play celebration sound...");
				celebration.currentTime = 0;
				void celebration.play().catch((err) => {
					console.error("Audio Play Error:", err);
				});
				gavel.onended = null;
			};

			void gavel.play().catch(() => {
				// If gavel cannot play, try celebration directly.
				if (celebration) {
					celebration.currentTime = 0;
					void celebration.play().catch(() => {
						// Ignore autoplay restrictions or missing audio file.
					});
				}
				gavel.onended = null;
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

	function playTick() {
		try {
			if (tickTickAudio.current) {
				tickTickAudio.current.currentTime = 0;
				void tickTickAudio.current.play().catch(() => {
					// Fall back to synthesized tick when media playback fails.
				});
				return;
			}

			if (typeof window === "undefined") {
				return;
			}

			const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!Ctx) {
				return;
			}

			if (!audioCtxRef.current) {
				audioCtxRef.current = new Ctx();
			}

			const ctx = audioCtxRef.current;
			if (ctx.state === "suspended") {
				void ctx.resume();
			}

			const oscillator = ctx.createOscillator();
			const gain = ctx.createGain();

			oscillator.type = "square";
			oscillator.frequency.setValueAtTime(1200, ctx.currentTime);
			gain.gain.setValueAtTime(0.0001, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);

			oscillator.connect(gain);
			gain.connect(ctx.destination);

			oscillator.start(ctx.currentTime);
			oscillator.stop(ctx.currentTime + 0.1);
		} catch {
			// Never block timer flow for optional cue.
		}
	}

	function resetTickAudio() {
		if (!tickTickAudio.current) {
			return;
		}

		tickTickAudio.current.pause();
		tickTickAudio.current.currentTime = 0;
	}

	function normalizePlayerCategory(player: Player): Player {
		return {
			...player,
			category: toThreeCategory(player.category || player.position),
		};
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
					? parsed.history.map((item: unknown, index: number) => {
						const record =
							typeof item === "object" && item !== null
								? (item as {
									id?: unknown;
									playerName?: unknown;
									price?: unknown;
									captainName?: unknown;
									captainSide?: unknown;
									timestamp?: unknown;
									buyer?: unknown;
								})
								: {};

						return {
							id: String(record.id || `${record.playerName || "player"}-${Date.now()}-${index}`),
							playerName: String(record.playerName || "Unknown"),
							price: Number(record.price || 0),
							captainName: String(record.captainName || record.buyer || "Unknown"),
							captainSide: record.captainSide === "captain2" ? "captain2" : "captain1",
							timestamp: String(record.timestamp || new Date().toISOString()),
						};
					})
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
		if (gavelAudioRef.current) {
			gavelAudioRef.current.preload = "auto";
			gavelAudioRef.current.load();
		}
		if (celebrationAudioRef.current) {
			celebrationAudioRef.current.preload = "auto";
			celebrationAudioRef.current.volume = 1.0;
			celebrationAudioRef.current.load();
		}
		console.log("celebrationAudioRef.current initialized:", celebrationAudioRef.current !== null);
		if (tickTickAudio.current) {
			tickTickAudio.current.preload = "auto";
			tickTickAudio.current.load();
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
			if (timerIntervalRef.current) {
				clearInterval(timerIntervalRef.current);
			}
			if (gavelAudioRef.current) {
				gavelAudioRef.current.onended = null;
			}
			stopCelebrationAudio();
			if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
				void audioCtxRef.current.close();
			}
		};
	}, []);

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
	const handleTimerExpired = useCallback(async (expiredPlayer: Player) => {
		if (!expiredPlayer) {
			timerExpiryInFlightRef.current = false;
			return;
		}

		resetTickAudio();

		const hasHighestBid = roundedBid > 0 && Boolean(lastBidder) && Boolean(lastBidderSide);

		try {
			if (hasHighestBid && lastBidder && lastBidderSide) {
				console.log("Fetching from:", API_URL);
				const soldResponse = await fetch(`${API_URL}/sold`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-admin-key": adminKey,
					},
					body: JSON.stringify({
						name: expiredPlayer.name,
						bidderName: lastBidder,
						amount: roundedBid,
					}),
				});

				const soldData = await soldResponse.json();

				if (!soldResponse.ok) {
					throw new Error(soldData.error || "Failed to auto-sell player");
				}

				playSoldAudioSequence();

				const soldPlayer = {
					...normalizePlayerCategory(expiredPlayer),
					isSold: true,
					soldPrice: roundedBid,
				};

				if (lastBidderSide === "captain1") {
					setCaptain1Budget((prev) => Number((prev - roundedBid).toFixed(1)));
					setCaptain1Roster((prev) => [...prev, soldPlayer]);
				} else {
					setCaptain2Budget((prev) => Number((prev - roundedBid).toFixed(1)));
					setCaptain2Roster((prev) => [...prev, soldPlayer]);
				}

				setPlayerPool((prev) =>
					prev.map((player) => {
						if (player.name.trim().toLowerCase() !== expiredPlayer.name.trim().toLowerCase()) {
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
						id: `${expiredPlayer.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
						playerName: expiredPlayer.name,
						price: roundedBid,
						captainName: lastBidder,
						captainSide: lastBidderSide,
						timestamp: new Date().toISOString(),
					},
				]);

				setStatusMessage(
					`${expiredPlayer.name} auto-sold to ${lastBidder} for ${formatMoneyMillion(roundedBid)} (timer expired).`
				);
				triggerCountFlash();
				setCurrentPlayer(null);
				setCurrentBid(0);
				setLastBidder(null);
				setLastBidderSide(null);
				setBidTimestamps([]);
				setPreviousPlayer(null);
				return;
			}

			console.log("Fetching from:", API_URL);
			const response = await fetch(`${API_URL}/sold`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-admin-key": adminKey,
				},
				body: JSON.stringify({ name: expiredPlayer.name, timerExpired: true }),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Failed to mark player as unsold");
			}

			// Add to unsold list
			setUnsoldPlayers((prev) => [...prev, normalizePlayerCategory(expiredPlayer)]);
			setStatusMessage(`${expiredPlayer.name} returned to unsold pool (timer expired).`);
			setCurrentPlayer(null);
			setCurrentBid(0);
			setLastBidder(null);
			setLastBidderSide(null);
			setBidTimestamps([]);
			setPreviousPlayer(null);
		} catch (error) {
			setStatusMessage(error instanceof Error ? error.message : "Failed to mark unsold");
		} finally {
			timerExpiryInFlightRef.current = false;
		}
	}, [adminKey, roundedBid, lastBidder, lastBidderSide]);

	useEffect(() => {
		if (!timerActive || !currentPlayer) {
			return;
		}

		if (timerIntervalRef.current) {
			clearInterval(timerIntervalRef.current);
		}

		const interval = setInterval(() => {
			setTimeRemaining((prev) => {
				const newTime = prev - 1;

				if (newTime <= 5 && newTime > 0) {
					playTick();
				}

				if (newTime <= 0) {
					if (!timerExpiryInFlightRef.current) {
						timerExpiryInFlightRef.current = true;
						handleTimerExpired(currentPlayer);
					}
					setTimerActive(false);
					return 10;
				}

				return newTime;
			});
		}, 1000);

		timerIntervalRef.current = interval;

		return () => clearInterval(interval);
	}, [timerActive, currentPlayer, handleTimerExpired]);

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
		stopCelebrationAudio();
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
		if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
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
			const cleanCaptainsString = captainsInput
				.split(",")
				.map((name) => name.trim().toLowerCase())
				.filter((name) => name.length > 0)
				.join(",");
			formData.append("captains", cleanCaptainsString);

			const uploadUrl = `${API_URL}/upload`;
			console.log("Target URL:", API_URL + "/upload");

			let response: Response;
			try {
				response = await fetch(uploadUrl, {
					method: "POST",
					headers: {
						"x-admin-key": adminKey,
					},
					body: formData,
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error("FETCH ERROR:", errorMessage);
				alert("Cannot reach backend server. Is it running?");
				throw error;
			}

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
		stopCelebrationAudio();
		setDrawing(true);
		setStatusMessage(position ? `Drawing an unsold ${position} player...` : "Drawing a random unsold player...");

		try {
			const query = position ? `?category=${encodeURIComponent(position)}` : "";
			console.log("Fetching from:", API_URL);
			const response = await fetch(`${API_URL}/draw${query}`, {
				headers: {
					"x-admin-key": adminKey,
				},
			});
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
			setStatusMessage(`${bidderName} cannot bid ${formatMoneyMillion(nextBid)} due to insufficient balance.`);
			return;
		}

		setCurrentBid(nextBid);
		setLastBidder(bidderName);
		setLastBidderSide(side);
		stopCelebrationAudio();
		resetTickAudio();
		setBidTimestamps((prev) => [...prev.slice(-3), Date.now()]);
		triggerLastBidderHighlight();

		if (roundedBid === 0) {
			setTimeRemaining(10);
			setTimerActive(true);
			setStatusMessage(`${bidderName} opened at ${formatMoneyMillion(1)}. Timer started at 10s.`);
			return;
		}

		setTimeRemaining(20);
		setTimerActive(true);
		triggerTimerExtendFlash();
		playBlip();
		setStatusMessage(`${bidderName} raised the bid to ${formatMoneyMillion(nextBid)}. Timer extended to 20s.`);
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
		setStatusMessage(`Bid reduced to ${formatMoneyMillion(newBid)}.`);
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

	async function handleSold() {
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
		setTimerActive(false);
		resetTickAudio();

		try {
			console.log("Fetching from:", API_URL);
			const response = await fetch(`${API_URL}/sold`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-admin-key": adminKey,
				},
				body: JSON.stringify({
					name: currentPlayer.name,
					bidderName: buyerName,
					amount: roundedBid,
				}),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Failed to mark player as sold");
			}

			playSoldAudioSequence();

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

			setStatusMessage(`${currentPlayer.name} sold to ${buyerName} for ${formatMoneyMillion(roundedBid)}.`);
			triggerCountFlash();
			if (isFinalSale) {
				setIsFinalScreenOpen(true);
			}
			setCurrentPlayer(null);
			setCurrentBid(0);
			setLastBidder(null);
			setLastBidderSide(null);
			setTimeRemaining(10);
			setBidTimestamps([]);
			setIsLastBidderHighlighted(false);
		} catch (error) {
			setStatusMessage(error instanceof Error ? error.message : "Failed to mark sold");
		} finally {
			setSelling(false);
		}
	}

	function handleExportExcel(soldPlayers: Player[]) {
		if (soldPlayers.length === 0) {
			setStatusMessage("No sold players available to export.");
			return;
		}

		const exportRows = soldPlayers.map((player) => ({
			Name: player.name,
			Category: toThreeCategory(player.category || player.position),
			Position: toShortForm(player.position),
			"Price Paid": player.soldPrice ?? 0,
			AvgRating: player.avgRating ?? 0,
			LastMatchRating: player.lastMatchRating ?? "N/A",
			"Last Match Stats": player.lastMatchStats ?? "N/A",
		}));

		const worksheet = XLSX.utils.json_to_sheet(exportRows);
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, worksheet, "Final Squads");
		XLSX.writeFile(workbook, "Auction_Final_Squads.xlsx");
		setStatusMessage("Final squads exported to Auction_Final_Squads.xlsx");
	}

	const captain1FinalCounts = useMemo(() => getSquadCounts(sortedCaptain1FinalRoster), [sortedCaptain1FinalRoster]);
	const captain2FinalCounts = useMemo(() => getSquadCounts(sortedCaptain2FinalRoster), [sortedCaptain2FinalRoster]);

	if (activeTab === "landing") {
		return (
			<main
				className={`${bodyFont.className} relative min-h-screen overflow-hidden bg-slate-950 text-white`}
			>
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(16,185,129,0.2),transparent_32%),radial-gradient(circle_at_82%_20%,rgba(56,189,248,0.24),transparent_36%),radial-gradient(circle_at_48%_100%,rgba(234,179,8,0.18),transparent_42%)]" />
				<div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
					<div className="w-full max-w-5xl rounded-3xl border border-cyan-300/40 bg-slate-900/85 p-8 text-center shadow-[0_0_80px_rgba(14,165,233,0.2)] sm:p-12">
						<p className="text-xs font-extrabold uppercase tracking-[0.32em] text-cyan-300">Football Operations Hub</p>
						<h1 className={`${displayFont.className} mt-4 text-5xl tracking-wide text-white sm:text-7xl`}>
							Football Auction Dashboard
						</h1>
						<p className="mx-auto mt-4 max-w-2xl text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
							Choose your mode to run the live auction or explore every registered player.
						</p>
						<div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
							<button
								onClick={() => setActiveTab("auction")}
								className="group rounded-2xl border border-cyan-200/40 bg-gradient-to-br from-cyan-500/30 via-blue-600/30 to-slate-900 px-8 py-8 text-left transition hover:-translate-y-1 hover:border-cyan-200/70"
							>
								<p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Live Control</p>
								<p className={`${displayFont.className} mt-2 text-4xl text-white`}>Enter Auction</p>
								<p className="mt-2 text-sm text-slate-200">Open admin login and run the bidding dashboard.</p>
							</button>
							<button
								onClick={() => setActiveTab("gallery")}
								className="group rounded-2xl border border-amber-200/45 bg-gradient-to-br from-amber-500/35 via-yellow-500/25 to-slate-900 px-8 py-8 text-left transition hover:-translate-y-1 hover:border-amber-200/75"
							>
								<p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Scouting Desk</p>
								<p className={`${displayFont.className} mt-2 text-4xl text-white`}>View Players</p>
								<p className="mt-2 text-sm text-slate-200">Browse player cards without touching auction state.</p>
							</button>
						</div>
					</div>
				</div>
			</main>
		);
	}

	if (activeTab === "gallery") {
		return (
			<PlayerGallery
				onBackHome={() => setActiveTab("landing")}
				bodyFontClass={bodyFont.className}
				displayFontClass={displayFont.className}
			/>
		);
	}

	return (
		<main
			className={`${bodyFont.className} min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 text-slate-900`}
		>
			<div className="fixed right-4 top-4 z-[90] rounded-full border border-white/20 bg-slate-900/90 p-2 shadow-xl">
				<svg
					viewBox="0 0 24 24"
					className={`h-5 w-5 ${isAuthorized ? "text-emerald-400" : "text-red-500"}`}
					fill="currentColor"
					aria-label={isAuthorized ? "Secured" : "Locked"}
				>
					<path d="M12 2 4 5v6c0 5.25 3.5 10.17 8 11 4.5-.83 8-5.75 8-11V5l-8-3Zm0 2.18L18 6.2V11c0 4.1-2.58 8.08-6 8.95C8.58 19.08 6 15.1 6 11V6.2l6-2.02Zm0 2.32a3 3 0 0 0-3 3v1H8a1 1 0 0 0-1 1V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-4.5a1 1 0 0 0-1-1h-1v-1a3 3 0 0 0-3-3Zm-1 4v-1a1 1 0 1 1 2 0v1h-2Z" />
				</svg>
			</div>

			{!isAuthorized && (
				<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 px-4">
					<div className="w-full max-w-md rounded-2xl border border-cyan-400/40 bg-slate-900 p-6 shadow-2xl">
						<h2 className={`${displayFont.className} text-4xl tracking-wide text-cyan-300`}>Admin Access</h2>
						<p className="mt-2 text-sm text-slate-300">Enter admin password to unlock the dashboard.</p>
						<input
							type="password"
							value={adminKey}
							onChange={(event) => {
								setAdminKey(event.target.value);
								if (loginError) {
									setLoginError("");
								}
							}}
							className="mt-5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-cyan-400"
							placeholder="Enter admin key"
						/>
						{loginError && <p className="mt-3 text-sm font-semibold text-red-400">{loginError}</p>}
						<button
							onClick={handleLogin}
							className="mt-4 w-full rounded-lg bg-cyan-500 px-4 py-2 text-sm font-extrabold uppercase tracking-wide text-slate-950 transition hover:bg-cyan-400"
						>
							Unlock Dashboard
						</button>
					</div>
				</div>
			)}

			<div className="mx-auto w-full">
				{/* TOP SECTION: Player Spotlight Banner */}
			<section className="sticky top-0 z-40 w-full border-b-4 border-yellow-400 bg-slate-900 px-4 py-3 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-7xl">
					<div className="mb-3 flex items-center justify-between gap-3">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">Player Info</p>
						<button
							onClick={() => setIsRemainingPoolOpen(true)}
							className="rounded-lg border border-blue-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-500 transition hover:bg-blue-500/10"
						>
							View Remaining Pool
						</button>
					</div>
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
										<span>Matches Played: {currentPlayer.matchesPlayed ?? "N/A"}</span>
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
										{formatMoneyMillion(roundedBid)}
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
														<div className="mb-8 w-full rounded-2xl border border-slate-600 bg-slate-900/50 p-4">
															<label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
																Captains (comma-separated)
															</label>
															<input
																type="text"
																value={captainsInput}
																onChange={(event) => setCaptainsInput(event.target.value)}
																placeholder="e.g. Lionel Messi, Cristiano Ronaldo"
																className="mt-2 w-full rounded-xl border border-slate-500 bg-slate-800 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
															/>
															<p className="mt-2 text-xs text-slate-400">
																Players listed here will be excluded from the auction pool at upload.
															</p>
														</div>
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
												<span className="font-bold text-emerald-300">{formatMoneyMillion(entry.price)}</span>
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
								<p className="mt-2 text-sm text-slate-300">Category Summary: Att {captain1FinalCounts.Att} | Mid {captain1FinalCounts.Mid} | Def {captain1FinalCounts.Def}</p>
								<p className="text-sm text-slate-300">Total Expenditure: {formatMoneyMillion(captain1Summary.totalSpent)}</p>
								<p className="text-sm text-slate-300">Remaining Budget: {formatMoneyMillion(captain1Budget)}</p>
								<p className="text-sm text-slate-300">Squad: {captain1Roster.length}/{FINAL_SQUAD_SIZE}</p>

								<div className="mt-4 overflow-x-auto rounded-lg border border-slate-700">
									<table className="min-w-full text-left text-xs">
										<thead className="bg-slate-900/70 text-slate-300">
											<tr>
												<th className="px-3 py-2">Player</th>
												<th className="px-3 py-2">Cat</th>
												<th className="px-3 py-2">Matches Played</th>
												<th className="px-3 py-2">Price</th>
											</tr>
										</thead>
										<tbody>
											{sortedCaptain1FinalRoster.length === 0 ? (
												<tr>
													<td colSpan={4} className="px-3 py-3 text-slate-400">No players yet</td>
												</tr>
											) : (
												sortedCaptain1FinalRoster.map((player, index) => (
													<tr key={`c1-${player.name}-${index}`} className="border-t border-slate-700/70">
														<td className="px-3 py-2 font-semibold text-white">{player.name}</td>
														<td className="px-3 py-2 text-slate-300">{toThreeCategory(player.category || player.position)}</td>
														<td className="px-3 py-2 text-slate-300">{player.matchesPlayed ?? "N/A"}</td>
														<td className="px-3 py-2 font-semibold text-emerald-300">{formatMoneyMillion(player.soldPrice ?? 0)}</td>
													</tr>
												))
											)}
										</tbody>
									</table>
								</div>
								<p className="mt-3 text-sm font-semibold text-cyan-200">Total Players: {sortedCaptain1FinalRoster.length}</p>
							</div>

							<div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
								<h3 className={`${displayFont.className} text-3xl text-cyan-300`}>{captain2Name}</h3>
								<p className="mt-2 text-sm text-slate-300">Category Summary: Att {captain2FinalCounts.Att} | Mid {captain2FinalCounts.Mid} | Def {captain2FinalCounts.Def}</p>
								<p className="text-sm text-slate-300">Total Expenditure: {formatMoneyMillion(captain2Summary.totalSpent)}</p>
								<p className="text-sm text-slate-300">Remaining Budget: {formatMoneyMillion(captain2Budget)}</p>
								<p className="text-sm text-slate-300">Squad: {captain2Roster.length}/{FINAL_SQUAD_SIZE}</p>

								<div className="mt-4 overflow-x-auto rounded-lg border border-slate-700">
									<table className="min-w-full text-left text-xs">
										<thead className="bg-slate-900/70 text-slate-300">
											<tr>
												<th className="px-3 py-2">Player</th>
												<th className="px-3 py-2">Cat</th>
												<th className="px-3 py-2">Matches Played</th>
												<th className="px-3 py-2">Price</th>
											</tr>
										</thead>
										<tbody>
											{sortedCaptain2FinalRoster.length === 0 ? (
												<tr>
													<td colSpan={4} className="px-3 py-3 text-slate-400">No players yet</td>
												</tr>
											) : (
												sortedCaptain2FinalRoster.map((player, index) => (
													<tr key={`c2-${player.name}-${index}`} className="border-t border-slate-700/70">
														<td className="px-3 py-2 font-semibold text-white">{player.name}</td>
														<td className="px-3 py-2 text-slate-300">{toThreeCategory(player.category || player.position)}</td>
														<td className="px-3 py-2 text-slate-300">{player.matchesPlayed ?? "N/A"}</td>
														<td className="px-3 py-2 font-semibold text-emerald-300">{formatMoneyMillion(player.soldPrice ?? 0)}</td>
													</tr>
												))
											)}
										</tbody>
									</table>
								</div>
								<p className="mt-3 text-sm font-semibold text-cyan-200">Total Players: {sortedCaptain2FinalRoster.length}</p>
							</div>
							<div className="lg:col-span-2">
								<button
									onClick={() => handleExportExcel([...captain1Roster, ...captain2Roster])}
									className="mt-2 inline-flex items-center gap-2 rounded-xl bg-green-700 px-5 py-3 text-sm font-extrabold uppercase tracking-wide text-white transition hover:bg-green-600"
								>
									<svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
										<path d="M4 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l8-8V5a2 2 0 0 0-2-2H4Zm9 2v7h7" />
										<path d="M7 12h3v3H7zm0 4h3v3H7zm4-4h3v3h-3zm0 4h3v3h-3z" />
									</svg>
									Export to Excel
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{isRemainingPoolOpen && (
				<div className="fixed inset-0 z-[85] bg-slate-950/90 px-4 py-6 backdrop-blur-sm sm:px-8">
					<div className="mx-auto flex h-full max-w-4xl flex-col rounded-2xl border border-blue-500/40 bg-slate-900 p-5 text-white shadow-2xl sm:p-6">
						<div className="flex items-start justify-between gap-3">
							<div>
								<h3 className={`${displayFont.className} text-3xl tracking-wide text-blue-300 sm:text-4xl`}>
									Remaining Player Pool
								</h3>
								<p className="mt-1 text-xs uppercase tracking-[0.15em] text-slate-400">
									War Room Lookup
								</p>
							</div>
							<button
								onClick={() => {
									setIsRemainingPoolOpen(false);
									setRemainingSearch("");
								}}
								className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-extrabold text-white transition hover:bg-slate-600"
							>
								Close
							</button>
						</div>

						<div className="mt-4">
							<input
								type="text"
								value={remainingSearch}
								onChange={(event) => setRemainingSearch(event.target.value)}
								placeholder="Search by player name or position"
								className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-400"
							/>
						</div>

						<div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-slate-700 p-3">
							{filteredRemainingPlayers.length === 0 ? (
								<p className="text-sm text-slate-400">No matching remaining players found.</p>
							) : (
								<div className="space-y-4">
									{(["Att", "Mid", "Def"] as PositionFilter[]).map((category) => (
										<div key={category}>
											<p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-blue-300">
												{category === "Att" ? "Attackers" : category === "Mid" ? "Midfielders" : "Defenders"} ({groupedRemainingPlayers[category].length})
											</p>
											<div className="space-y-1">
												{groupedRemainingPlayers[category].length === 0 ? (
													<p className="rounded-md border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-500">
														No players in this category.
													</p>
												) : (
													groupedRemainingPlayers[category].map((player) => (
														<div
															key={`remaining-${category}-${player.name}-${player.position}`}
															className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm"
														>
															<span className="font-semibold text-white">{player.name}</span>
															<span className="text-slate-400">{toShortForm(player.position)}</span>
														</div>
													))
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</main>
	);
}

function PlayerGallery({
	onBackHome,
	bodyFontClass,
	displayFontClass,
}: {
	onBackHome: () => void;
	bodyFontClass: string;
	displayFontClass: string;
}) {
	const [players, setPlayers] = useState<GalleryPlayer[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const [categoryFilter, setCategoryFilter] = useState<"All" | PositionFilter>("All");

	useEffect(() => {
		let isMounted = true;

		async function loadPlayers() {
			setLoading(true);
			setError("");

			try {
				const response = await fetch(`${API_URL}/players`);
				const payload = await response.json();

				if (!response.ok) {
					throw new Error(payload?.error || "Failed to fetch players");
				}

				const rawPlayers = Array.isArray(payload) ? payload : Array.isArray(payload?.players) ? payload.players : [];
				const normalizedPlayers: GalleryPlayer[] = rawPlayers
					.map((item: Record<string, unknown>) => {
						const name = String(item?.name || item?.playerName || "").trim();
						const position = String(item?.position || item?.role || "").trim();
						const categorySource = String(item?.category || position || "").trim();
						const imageFilename = String(item?.imageFilename || item?.image || item?.photo || item?.avatar || "").trim();

						return {
							name,
							position,
							category: toThreeCategory(categorySource),
							imageFilename: imageFilename || undefined,
						};
					})
					.filter((player: GalleryPlayer) => player.name.length > 0)
					.sort((a: GalleryPlayer, b: GalleryPlayer) => a.name.localeCompare(b.name));

				if (!isMounted) {
					return;
				}

				setPlayers(normalizedPlayers);
			} catch (loadError) {
				if (!isMounted) {
					return;
				}

				setError(loadError instanceof Error ? loadError.message : "Failed to fetch players");
				setPlayers([]);
			} finally {
				if (isMounted) {
					setLoading(false);
				}
			}
		}

		void loadPlayers();

		return () => {
			isMounted = false;
		};
	}, []);

	const filteredPlayers = useMemo(() => {
		const query = search.trim().toLowerCase();
		return players.filter((player) => {
			if (categoryFilter !== "All" && toThreeCategory(player.category) !== categoryFilter) {
				return false;
			}

			if (!query) {
				return true;
			}

			const name = String(player.name || "").toLowerCase();
			const position = String(player.position || "").toLowerCase();
			return name.includes(query) || position.includes(query);
		});
	}, [players, search, categoryFilter]);

	function getPlayerImageUrl(player: GalleryPlayer) {
		const direct = String(player.image || player.imageFilename || "").trim();
		if (!direct) {
			return `https://ui-avatars.com/api/?name=${encodeURIComponent(player.name)}&background=0f172a&color=facc15&size=512&bold=true`;
		}

		if (/^https?:\/\//i.test(direct) || direct.startsWith("/players/")) {
			return direct;
		}

		return `${API_URL}/players/${direct}`;
	}

	function getCategoryTagClass(category: PositionFilter) {
		if (category === "Att") {
			return "border-rose-300/70 bg-rose-500/20 text-rose-100";
		}

		if (category === "Mid") {
			return "border-emerald-300/70 bg-emerald-500/20 text-emerald-100";
		}

		return "border-sky-300/70 bg-sky-500/20 text-sky-100";
	}

	return (
		<main className={`${bodyFontClass} min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white`}>
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<button
						onClick={onBackHome}
						className="rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-4 py-2 text-sm font-extrabold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/30"
					>
						Return to Home
					</button>
					<div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
						<input
							type="text"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search by name or position"
							className="w-full rounded-xl border border-slate-500 bg-slate-900 px-4 py-2 text-sm font-semibold text-white outline-none transition focus:border-amber-400 sm:w-72"
						/>
						<select
							value={categoryFilter}
							onChange={(event) => setCategoryFilter(event.target.value as "All" | PositionFilter)}
							className="rounded-xl border border-slate-500 bg-slate-900 px-4 py-2 text-sm font-semibold text-white outline-none transition focus:border-cyan-400"
						>
							<option value="All">Category: All</option>
							<option value="Att">Category: Att</option>
							<option value="Mid">Category: Mid</option>
							<option value="Def">Category: Def</option>
						</select>
					</div>
				</div>

				<div className="mb-6">
					<h1 className={`${displayFontClass} text-4xl tracking-wide text-amber-300 sm:text-5xl`}>
						Player Gallery
					</h1>
					<p className="mt-2 text-sm uppercase tracking-[0.16em] text-slate-300">
						Top Trumps Style Scout Board
					</p>
					<p className="mt-2 text-sm text-slate-400">
						Showing {filteredPlayers.length} of {players.length} players
					</p>
				</div>

				{loading ? (
					<div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-8 text-center text-slate-300">
						Loading players...
					</div>
				) : error ? (
					<div className="rounded-2xl border border-rose-500/50 bg-rose-900/20 p-8 text-center text-rose-200">
						Unable to load /players: {error}
					</div>
				) : players.length === 0 ? (
					<div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center text-slate-400">
						No players were returned by the server.
					</div>
				) : filteredPlayers.length === 0 ? (
					<div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center text-slate-400">
						No players match your search.
					</div>
				) : (
					<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
						{filteredPlayers.map((player, index) => {
							const imageUrl = getPlayerImageUrl(player);
							const normalizedCategory = toThreeCategory(player.category || player.position);

							return (
								<article
									key={`${player.name}-${player.position}-${index}`}
									className="group overflow-hidden rounded-2xl border border-amber-300/40 bg-gradient-to-b from-slate-900 via-slate-950 to-black shadow-[0_10px_25px_rgba(0,0,0,0.45)] transition hover:-translate-y-1 hover:border-amber-300/70"
								>
									<div className="relative h-56 border-b border-amber-300/30 bg-black">
										<img
											src={imageUrl}
											alt={player.name}
											className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
										/>
										<div className="absolute left-3 top-3 rounded-full border border-cyan-300/60 bg-cyan-500/20 px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200">
											{toShortForm(player.position)}
										</div>
									</div>
									<div className="p-4">
										<h3 className="line-clamp-1 text-lg font-extrabold text-white">{player.name}</h3>
										<div className="mt-2 flex items-center justify-between gap-2">
											<p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
												Position: {toShortForm(player.position)}
											</p>
											<span className={`rounded-full border px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] ${getCategoryTagClass(normalizedCategory)}`}>
												{normalizedCategory}
											</span>
										</div>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</div>
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
}: {
	captainName: string;
	onCaptainNameChange: (name: string) => void;
	budget: number;
	roster: Player[];
	requiredSquadSize: number;
	tone: "left" | "right";
	cardId: string;
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
			</div>

			<div className="mt-2 max-h-[420px] space-y-1 overflow-y-auto pr-1">
				{rosterWithPurchaseNumber.length === 0 ? (
					<p
						className={`rounded-lg border border-dashed ${borderColor} px-2 py-2 text-xs ${
							isLeft ? "bg-slate-50 text-slate-500" : "bg-slate-900/40 text-slate-400"
						}`}
					>
						No players yet
					</p>
				) : (
					rosterWithPurchaseNumber.map(({ player, purchaseNumber }, index) => (
						<div
							key={`${player.name}-${player.position}-${index}`}
							className={`rounded-lg border ${borderColor} px-2 py-2 text-xs ${
								isLeft ? "bg-slate-50 text-slate-900" : "bg-slate-900/50 text-white"
							}`}
						>
							<div className="flex items-center gap-2">
								<span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[10px] font-extrabold text-white">
									{purchaseNumber}
								</span>
								<p className="font-bold">{player.name}</p>
							</div>
							<p className={isLeft ? "text-slate-600" : "text-slate-400"}>
								{toShortForm(player.position)}
							</p>
							<p className={`pt-1 font-semibold ${isLeft ? "text-teal-600" : "text-teal-400"}`}>
								{formatMoneyMillion(player.soldPrice ?? 0)}
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
							{formatMoneyMillion(budget)}
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

					<div className={`px-4 py-3`} />
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

function formatMoneyMillion(value: number) {
	const numeric = Number(value || 0);
	const formatted = numeric.toFixed(1).replace(/\.0$/, "");
	return `£${formatted}M`;
}
