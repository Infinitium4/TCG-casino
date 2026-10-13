const rouletteModule = (() => {
  const wheelNumbers = [
    "0", "28", "9", "26", "30", "11", "7", "20", "32", "17", "5", "22", "34", "15", "3", "24", "36", "13", "1", "00", "27", "10", "25", "29", "12", "8", "19", "31", "18", "6", "21", "33", "16", "4", "23", "35", "14", "2"
  ];
  const state = {
    currentBet: null,
    selectedBetType: "red",
    wheelLocked: false,
    rotation: 0,
    lastResults: []
  };

  function initialize() {
    const wheel = document.getElementById("rouletteWheel");
    const rotor = document.getElementById("rouletteRotor");
    const placeBetButton = document.getElementById("roulettePlaceBet");
    const spinButton = document.getElementById("rouletteSpinBtn");

    renderWheelNumbers();
    renderBoardColors();
    new ResizeObserver(() => renderWheelNumbers()).observe(wheel);

    document.querySelectorAll(".bet-choice").forEach((button) => {
      button.addEventListener("click", () => selectBetType(button.dataset.bet));
    });

    document.querySelectorAll(".chip-option").forEach((button) => {
      button.addEventListener("click", () => selectStake(Number(button.dataset.stake)));
    });

    document.querySelectorAll(".board-cell").forEach((button) => {
      button.addEventListener("click", () => {
        const number = button.dataset.boardNumber;
        const exactInput = document.getElementById("rouletteExactNumber");
        if (exactInput) {
          exactInput.value = number;
        }
        selectBetType("exact");
        document.querySelectorAll(".board-cell").forEach((cell) => cell.classList.toggle("active", cell === button));
      });
    });

    document.getElementById("rouletteExactNumber").addEventListener("input", () => {
      const value = document.getElementById("rouletteExactNumber").value;
      if (value === "00" || Number.isFinite(Number(value))) {
        selectBetType("exact");
      }
    });

    placeBetButton.addEventListener("click", placeBet);
    spinButton.addEventListener("click", spinWheel);

    state.currentBet = null;
    rotor.style.transform = "rotate(0deg)";
    wheel.style.setProperty("--ball-radius", `${wheel.offsetWidth * 0.38}px`);
    renderHistory();
    selectBetType(state.selectedBetType);
  }

  function renderWheelNumbers() {
    const container = document.getElementById("rouletteNumbers");
    if (!container) return;

    container.innerHTML = "";
    const wheel = document.getElementById("rouletteWheel");
    const rotor = document.getElementById("rouletteRotor");
    const pocketAngle = 360 / wheelNumbers.length;
    const radius = wheel.offsetWidth * 0.31;
    const sectors = wheelNumbers.map((number, index) => {
      const color = getRouletteColor(number);
      const colorValue = color === "red" ? "#b82f32" : color === "black" ? "#171819" : "#087a50";
      return `${colorValue} ${index * pocketAngle}deg ${(index + 1) * pocketAngle}deg`;
    }).join(", ");

    rotor.style.setProperty("--wheel-sectors", sectors);
    rotor.style.setProperty("--pocket-angle", `${pocketAngle}deg`);
    wheel.style.setProperty("--ball-radius", `${wheel.offsetWidth * 0.38}px`);

    wheelNumbers.forEach((value, index) => {
      const angle = index * pocketAngle;
      const item = document.createElement("div");
      item.className = `roulette-number ${getRouletteColor(value)}`;
      item.style.setProperty("--angle", `${angle}deg`);
      item.style.setProperty("--radius", `${radius}px`);
      item.textContent = value;
      container.appendChild(item);
    });
  }

  function renderBoardColors() {
    document.querySelectorAll(".board-cell[data-board-number]").forEach((cell) => {
      const color = getRouletteColor(cell.dataset.boardNumber);
      cell.classList.remove("board-red", "board-black", "board-green");
      cell.classList.add(`board-${color}`);
    });
  }

  function selectBetType(type) {
    state.selectedBetType = type;
    document.querySelectorAll(".bet-choice").forEach((button) => {
      button.classList.toggle("active", button.dataset.bet === type);
    });

    const exactInput = document.getElementById("rouletteExactNumber");
    if (exactInput) {
      exactInput.disabled = type !== "exact";
    }

    if (type !== "exact") {
      document.querySelectorAll(".board-cell").forEach((cell) => {
        cell.classList.remove("active");
      });
    }

    updateBetControls();
  }

  function selectStake(value) {
    document.querySelectorAll(".chip-option").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.stake) === value);
    });
    const input = document.getElementById("rouletteCustomStake");
    input.value = value;
    updateBetControls();
  }

  function updateBetControls() {
    const exactInput = document.getElementById("rouletteExactNumber");
    exactInput.disabled = state.selectedBetType !== "exact";
  }

  function getBetLabel(type, exactNumber = null) {
    const labels = {
      red: "Rouge",
      black: "Noir",
      even: "Pair",
      odd: "Impair",
      manque: "1 à 18",
      passe: "19 à 36",
      exact: exactNumber === "00" ? "Numéro 00" : Number.isFinite(exactNumber) ? `Numéro ${exactNumber}` : "Numéro exact"
    };

    return labels[type] || type;
  }

  function placeBet() {
    const player = getPlayer();
    const betType = state.selectedBetType;
    const stake = Number(document.getElementById("rouletteCustomStake").value);
    const exactValue = document.getElementById("rouletteExactNumber").value;
    const exactNumber = exactValue === "00" ? "00" : Number(exactValue);

    if (!Number.isFinite(stake) || stake <= 0 || !Number.isInteger(stake)) {
      showToast("La mise doit être un nombre entier positif.");
      return;
    }

    if (stake > player.chips) {
      showToast("Mise supérieure au solde disponible.");
      return;
    }

    if (betType === "exact") {
      if (exactNumber !== "00" && (!Number.isInteger(exactNumber) || exactNumber < 0 || exactNumber > 36)) {
        showToast("Le numéro exact doit être 00 ou compris entre 0 et 36.");
        return;
      }
    }

    player.chips -= stake;
    savePlayer(player);
    updateTopbar();

    state.currentBet = {
      type: betType,
      amount: stake,
      exactNumber
    };

    const betText = getBetLabel(betType, exactNumber);
    document.getElementById("rouletteStatus").textContent = `Pari confirmé : ${betText} pour ${stake} jetons.`;
    document.getElementById("roulettePayout").textContent = "La roulette va tourner. Attention : le 00 apporte un avantage au casino.";
    showToast(`Pari de ${stake} jetons confirmé sur ${betText}.`);
  }

  function spinWheel() {
    if (state.wheelLocked) {
      return;
    }

    const wheel = document.getElementById("rouletteWheel");
    const scrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    wheel.closest(".roulette-stage").scrollIntoView({ behavior: scrollBehavior, block: "center" });

    if (!state.currentBet) {
      showToast("Aucun pari n'a été confirmé.");
      return;
    }

    const spinButton = document.getElementById("rouletteSpinBtn");
    const placeBetButton = document.getElementById("roulettePlaceBet");

    state.wheelLocked = true;
    spinButton.disabled = true;
    placeBetButton.disabled = true;

    const winningNumber = wheelNumbers[randomInt(0, wheelNumbers.length - 1)];
    const winningIndex = wheelNumbers.indexOf(winningNumber);
    const pocketAngle = 360 / wheelNumbers.length;
    const turns = Math.floor(Math.random() * 5) + 6;
    const targetRotation = -winningIndex * pocketAngle;
    const alignment = ((targetRotation - state.rotation) % 360 + 360) % 360;
    const finalRotation = state.rotation + (turns * 360) + alignment;
    state.rotation = finalRotation;
    const rotor = document.getElementById("rouletteRotor");
    const ballTrack = document.getElementById("rouletteBallTrack");
    rotor.style.transform = `rotate(${finalRotation}deg)`;
    ballTrack.style.setProperty("--ball-spin-angle", `${-turns * 360}deg`);
    ballTrack.classList.add("is-spinning");

    setTimeout(() => settleSpin(winningNumber), 3000);
  }

  function settleSpin(winningNumber) {
    const player = getPlayer();
    const bet = state.currentBet;
    const result = evaluateRouletteBet(bet, winningNumber);

    if (result.won) {
      player.chips += result.payoutTotal;
    }

    player.stats.gamesPlayed = Number(player.stats.gamesPlayed || 0) + 1;
    if (result.won) {
      player.stats.wins = Number(player.stats.wins || 0) + 1;
    }
    player.stats.bestWin = Math.max(Number(player.stats.bestWin || 0), result.payoutTotal);
    player.stats.lastPlayed = new Date().toISOString();

    savePlayer(player);
    updateTopbar();

    state.lastResults.unshift({
      number: winningNumber,
      color: getRouletteColor(winningNumber),
      outcome: result.won ? "Gagné" : "Perdu",
      labels: result.won ? `+${result.payoutTotal} jetons` : `-${bet.amount} jetons`
    });
    state.lastResults = state.lastResults.slice(0, 10);

    document.getElementById("rouletteBallTrack").classList.remove("is-spinning");

    const chosenType = getBetLabel(bet.type, bet.exactNumber);
    document.getElementById("rouletteStatus").textContent = `Le numéro gagnant est ${winningNumber}. ${result.message}`;
    document.getElementById("roulettePayout").textContent = `Ton pari ${chosenType} : ${result.won ? `gagné, +${result.payoutTotal} jetons` : "perdu"}.`;

    addHistoryEntry({
      game: "roulette",
      bet: bet.amount,
      result: result.won ? "Victoire" : "Défaite",
      payout: result.payoutTotal,
      net: result.won ? result.payoutTotal - bet.amount : -bet.amount,
      date: new Date().toISOString(),
      number: winningNumber
    });

    renderHistory();
    renderHomeView();
    renderLeaderboard();
    renderFilteredHistory();

    state.currentBet = null;
    state.wheelLocked = false;
    document.getElementById("rouletteSpinBtn").disabled = false;
    document.getElementById("roulettePlaceBet").disabled = false;
    state.lastResults = state.lastResults.slice(0, 10);
  }

  function evaluateRouletteBet(bet, winningNumber) {
    const amount = Number(bet.amount || 0);
    const winningColor = getRouletteColor(winningNumber);
    const numericNumber = Number(winningNumber);
    const isZero = winningNumber === "00" || numericNumber === 0;
    const isEven = numericNumber % 2 === 0 && !isZero;

    let won = false;
    let payout = 0;

    if (bet.type === "exact") {
      won = String(bet.exactNumber) === String(winningNumber);
      payout = won ? amount * 36 : 0;
    } else if (bet.type === "red") {
      won = winningColor === "red";
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "black") {
      won = winningColor === "black";
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "even") {
      won = isEven;
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "odd") {
      won = !isEven && !isZero;
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "manque") {
      won = numericNumber >= 1 && numericNumber <= 18;
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "passe") {
      won = numericNumber >= 19 && numericNumber <= 36;
      payout = won ? amount * 2 : 0;
    }

    return {
      won,
      payoutTotal: payout,
      message: won
        ? `Bravo ! La bille s'est arrêtée sur ${winningNumber}. Ton pari ${getBetLabel(bet.type, bet.exactNumber)} est gagnant.`
        : `La bille s'est arrêtée sur ${winningNumber}. Ton pari ${getBetLabel(bet.type, bet.exactNumber)} n'a pas été touché.`,
      number: winningNumber
    };
  }

  function renderHistory() {
    const container = document.getElementById("rouletteHistory");
    const entries = state.lastResults.length ? state.lastResults : [{ number: "—", color: "green", outcome: "Aucun", labels: "Aucun résultat" }];

    container.innerHTML = entries
      .slice(0, 10)
      .map(
        (entry) => `
          <div class="history-item">
            <span class="result-pill ${entry.color || "green"}">${entry.number}</span>
            <div>
              <strong>${entry.outcome}</strong><br />
              <small>${entry.labels}</small>
            </div>
          </div>
        `
      )
      .join("");
  }

  window.rouletteModule = { initialize };
  return { initialize };
})();
