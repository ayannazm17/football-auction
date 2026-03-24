# ⚽ Football Auction "War Room" Dashboard

An immersive, real-time auction platform designed for football squad selection. This application features a high-contrast dashboard, tactical pitch visualizations, and a dynamic bidding engine to simulate a professional "War Room" environment.

## 🚀 Features

- **Dynamic Bidding Engine**: 
  - Opening bids start at **1.0** (triggered by a Captain).
  - 10-second timer for the opening bid; 20-second reset for subsequent bids (+0.5 increments).
- **Tactical Pitch Map**: Symmetrical mini-pitches for both captains that visually place numbered dots (1-12) based on player categories.
- **Strict Categorization**: Supports exactly three categories: **Att** (Red), **Mid** (Green), and **Def** (Blue).
- **Real-time Analytics**: Live budget tracking, squad stats, and automated sorting (Att -> Mid -> Def).
- **Interactive UI**:
  - Gavel sound effects on successful sales.
  - Squad Card downloads (PNG) via `html2canvas`.
  - Final Squad Comparison overlay with a closeable modal.
- **Persistence**: LocalStorage integration ensures auction data survives page refreshes.

## 🛠️ Tech Stack

- **Frontend**: Next.js, Tailwind CSS, Lucide Icons, html2canvas, canvas-confetti.
- **Backend**: Node.js, Express.js, CSV-Parser / XLSX.
- **State Management**: React Hooks (useState, useEffect, useMemo).

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Git](https://git-scm.com/)

## 📦 Installation & Setup

### 1. Clone the Repository
```bash
git clone [https://github.com/ayannazm17/football-auction.git](https://github.com/ayannazm17/football-auction.git)
cd football-auction

2. Backend Setup
Bash

cd backend
npm install
node server.js
The server will run on http://localhost:5000.

3. Frontend Setup
Bash

cd ../frontend
npm install
npm run dev
The dashboard will be available at http://localhost:3000.

📊 Excel Data Format
Name,Category,Position,AvgRating,LastMatchRating,Last Match Stats
Player Name,Att/Mid/Def,e.g. ST,0-10,0-10,Text Description

Note: Ensure there are no spaces in the headers. "GK" players should be categorized as "Def" or removed from the file.

Gemini said
A great README.md is the "front door" of your project. Since your Football Auction App has some very specific rules (like the 10s/20s timer and the tactical pitch), it's important to document them clearly so others (or your future self) know exactly how it works.

Copy the block below and save it as a file named README.md in your root folder (C:\Users\AYAN\auction-app).

Markdown
# ⚽ Football Auction "War Room" Dashboard

An immersive, real-time auction platform designed for football squad selection. This application features a high-contrast dashboard, tactical pitch visualizations, and a dynamic bidding engine to simulate a professional "War Room" environment.

## 🚀 Features

- **Dynamic Bidding Engine**: 
  - Opening bids start at **1.0** (triggered by a Captain).
  - 10-second timer for the opening bid; 20-second reset for subsequent bids (+0.5 increments).
- **Tactical Pitch Map**: Symmetrical mini-pitches for both captains that visually place numbered dots (1-12) based on player categories.
- **Strict Categorization**: Supports exactly three categories: **Att** (Red), **Mid** (Green), and **Def** (Blue).
- **Real-time Analytics**: Live budget tracking, squad stats, and automated sorting (Att -> Mid -> Def).
- **Interactive UI**:
  - Gavel sound effects on successful sales.
  - Squad Card downloads (PNG) via `html2canvas`.
  - Final Squad Comparison overlay with a closeable modal.
- **Persistence**: LocalStorage integration ensures auction data survives page refreshes.

## 🛠️ Tech Stack

- **Frontend**: Next.js, Tailwind CSS, Lucide Icons, html2canvas, canvas-confetti.
- **Backend**: Node.js, Express.js, CSV-Parser / XLSX.
- **State Management**: React Hooks (useState, useEffect, useMemo).

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Git](https://git-scm.com/)

## 📦 Installation & Setup

### 1. Clone the Repository
```bash
git clone [https://github.com/ayannazm17/football-auction.git](https://github.com/ayannazm17/football-auction.git)
cd football-auction
2. Backend Setup
Bash
cd backend
npm install
node server.js
The server will run on http://localhost:5000.

3. Frontend Setup
Bash
cd ../frontend
npm install
npm run dev
The dashboard will be available at http://localhost:3000.

📊 Excel Data Format
To start the auction, you must upload an .xlsx or .csv file with the following headers:

Name	Category	Position	AvgRating	LastMatchRating	Last Match Stats
Player Name	Att/Mid/Def	e.g. ST	0-10	0-10	Text Description
Note: Ensure there are no spaces in the headers. "GK" players should be categorized as "Def" or removed from the file.

🔊 Assets
Ensure you have the following file in your frontend/public/ directory for the auction experience:

gavel.mp3: Triggered when a player is marked as SOLD.

🛡️ License
Distributed under the MIT License.
---

### 💡 How to add this to GitHub:

1.  In VS Code, click **New File** and name it `README.md`.
2.  Paste the content above and save it.
3.  Open your terminal and run:
    ```bash
    git add README.md
    git commit -m "docs: add comprehensive readme with instructions"
    git push origin main
    ```

### 🚀 Next Step: Hosting Prep
Since you want to host this, would you like me to help you create a **`Dockerfile`** or a **`Procfile`**? These files tell hosting platforms like Railway or Render exactly how to start your app in the cloud automatically.