const rouletteModule = (() => {
  const state = {
    currentBet: null,
    wheelLocked: false,
    rotation: 0,
    lastResults: []
  };

  function initialize() {
    const wheel = document.getElementById("rouletteWheel");
    const placeBetButton = document.getElementById("roulettePlaceBet");
    const spinButton = document.getElementById("rouletteSpinBtn");

    document.querySelectorAll(".bet-choice").forEach((button) => {
      button.addEventListener("click", () => selectBetType(button.dataset.bet));
    });

    document.querySelectorAll(".chip-option").forEach((button) => {
      button.addEventListener("click", () => selectStake(Number(button.dataset.stake)));
    });

    document.getElementById("rouletteExactNumber").addEventListener("input", () => {
      const value = Number(document.getElementById("rouletteExactNumber").value);
      if (Number.isFinite(value)) {
        selectBetType("exact");
      }
    });

    placeBetButton.addEventListener("click", placeBet);
    spinButton.addEventListener("click", spinWheel);

    state.currentBet = null;
    wheel.style.transform = "rotate(0deg)";
    renderHistory();
    updateBetControls();
  }

  function selectBetType(type) {
    document.querySelectorAll(".bet-choice").forEach((button) => {
      button.classList.toggle("active", button.dataset.bet === type);
    });
    const exactInput = document.getElementById("rouletteExactNumber");
    exactInput.disabled = type !== "exact";
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
    const activeType = document.querySelector(".bet-choice.active")?.dataset.bet || "red";
    exactInput.disabled = activeType !== "exact";
  }

  function placeBet() {
    const player = getPlayer();
    const betType = document.querySelector(".bet-choice.active")?.dataset.bet || "red";
    const stake = Number(document.getElementById("rouletteCustomStake").value);
    const exactNumber = Number(document.getElementById("rouletteExactNumber").value);

    if (!Number.isFinite(stake) || stake <= 0 || !Number.isInteger(stake)) {
      showToast("La mise doit être un nombre entier positif.");
      return;
    }

    if (stake > player.chips) {
      showToast("Mise supérieure au solde disponible.");
      return;
    }

    if (betType === "exact") {
      if (!Number.isInteger(exactNumber) || exactNumber < 0 || exactNumber > 36) {
        showToast("Le numéro exact doit être entre 0 et 36.");
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

    const betText = betType === "exact" ? `numéro ${exactNumber}` : betType;
    document.getElementById("rouletteStatus").textContent = `Pari confirmé : ${betText} pour ${stake} jetons.`;
    document.getElementById("roulettePayout").textContent = "La roulette va tourner.";
    showToast(`Pari de ${stake} jetons confirmé.`);
  }

  function spinWheel() {
    if (state.wheelLocked) {
      return;
    }

    if (!state.currentBet) {
      showToast("Aucun pari n'a été confirmé.");
      return;
    }

    const wheel = document.getElementById("rouletteWheel");
    const spinButton = document.getElementById("rouletteSpinBtn");
    const placeBetButton = document.getElementById("roulettePlaceBet");

    state.wheelLocked = true;
    spinButton.disabled = true;
    placeBetButton.disabled = true;

    const winningNumber = randomInt(0, 36);
    const extraTurn = 360 * (Math.floor(Math.random() * 5) + 6);
    const finalRotation = state.rotation + extraTurn + (360 - (winningNumber * 10));
    state.rotation = finalRotation;
    wheel.style.transform = `rotate(${finalRotation}deg)`;

    setTimeout(() => settleSpin(winningNumber), 2800);
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
      labels: result.won ? `${result.payoutTotal} jetons` : "0"
    });
    state.lastResults = state.lastResults.slice(0, 10);

    const chosenType = bet.type === "exact" ? `numéro ${bet.exactNumber}` : bet.type;
    document.getElementById("rouletteStatus").textContent = `Le numéro gagnant est ${winningNumber}. ${result.message}`;
    document.getElementById("roulettePayout").textContent = `Pari ${chosenType} : ${result.won ? `gain de ${result.payoutTotal} jetons` : "perdu"}.`;

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
    const isEven = winningNumber % 2 === 0 && winningNumber !== 0;

    let won = false;
    let payout = 0;

    if (bet.type === "exact") {
      won = Number(bet.exactNumber) === winningNumber;
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
      won = !isEven && winningNumber !== 0;
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "manque") {
      won = winningNumber >= 1 && winningNumber <= 18;
      payout = won ? amount * 2 : 0;
    } else if (bet.type === "passe") {
      won = winningNumber >= 19 && winningNumber <= 36;
      payout = won ? amount * 2 : 0;
    }

    return {
      won,
      payoutTotal: payout,
      message: won
        ? `Bravo, ${bet.type === "exact" ? `le numéro ${winningNumber} a été touché` : `le pari ${bet.type} gagne`}.`
        : `Le numéro ${winningNumber} ne convient pas.`,
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
