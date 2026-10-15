const rouletteModule = (() => {
  const wheelNumbers = [
    "0", "28", "9", "26", "30", "11", "7", "20", "32", "17", "5", "22", "34", "15", "3", "24", "36", "13", "1", "00", "27", "10", "25", "29", "12", "8", "19", "31", "18", "6", "21", "33", "16", "4", "23", "35", "14", "2"
  ];
  const state = {
    bets: [],
    previousBets: [],
    wheelLocked: false,
    rotation: 0,
    trackPosition: 0,
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
        placeBet("exact", button.dataset.boardNumber);
      });
    });

    document.getElementById("rouletteExactNumber").addEventListener("input", () => {
      const value = document.getElementById("rouletteExactNumber").value;
      if (value === "00" || Number.isFinite(Number(value))) {
        selectBetType("exact");
      }
    });

    placeBetButton.addEventListener("click", () => placeBet());
    document.getElementById("rouletteRepeatBet").addEventListener("click", repeatBets);
    renderRacetrack();
    document.querySelectorAll("[data-roulette-view]").forEach(button => {
      button.addEventListener("click", () => {
        const track = button.dataset.rouletteView === "track";
        document.querySelector(".roulette-stage").hidden = track;
        document.getElementById("rouletteRacetrack").hidden = !track;
        document.querySelectorAll("[data-roulette-view]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
        if (!track) renderWheelNumbers();
      });
    });
    renderBets();
    spinButton.addEventListener("click", spinWheel);

    state.bets = [];
    rotor.style.transform = "rotate(0deg)";
    wheel.style.setProperty("--ball-radius", `${wheel.offsetWidth * 0.38}px`);
    renderHistory();
    updateBetControls();
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
    document.querySelectorAll(".bet-choice").forEach((button) => {
      button.classList.toggle("active", button.dataset.bet === type);
    });

    const exactInput = document.getElementById("rouletteExactNumber");
    if (exactInput) {
      exactInput.disabled = type !== "exact";
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
    const activeType = document.querySelector(".bet-choice.active")?.dataset.bet || "red";
    exactInput.disabled = activeType !== "exact";
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

  function placeBet(selectedType, selectedNumber) {
    if (state.wheelLocked) return;
    const player = getPlayer();
    const betType = selectedType || document.querySelector(".bet-choice.active")?.dataset.bet || "red";
    const stake = Number(document.getElementById("rouletteCustomStake").value);
    const limits = window.casinoGameSettings?.roulette || { minBet: 0.01, maxBet: 1_000_000 };
    const exactValue = selectedNumber ?? document.getElementById("rouletteExactNumber").value;
    const exactNumber = exactValue === "00" ? "00" : Number(exactValue);

    if (!Number.isFinite(stake) || stake < limits.minBet || stake > limits.maxBet || !isMoney(stake)) {
      showToast(`La mise doit être comprise entre ${limits.minBet} et ${limits.maxBet} €.`);
      return;
    }

    if (stake > player.chips) {
      showToast("Mise supérieure au solde disponible.");
      return;
    }

    if (betType === "exact") {
      if (exactValue.trim() === "" || exactNumber !== "00" && (!Number.isInteger(exactNumber) || exactNumber < 0 || exactNumber > 36)) {
        showToast("Le numéro exact doit être 00 ou compris entre 0 et 36.");
        return;
      }
    }

    player.chips = roundMoney(player.chips - stake);
    savePlayer(player);
    updateTopbar();

    state.bets.push({
      type: betType,
      amount: stake,
      exactNumber
    });
    renderBets();

    const betText = getBetLabel(betType, exactNumber);
    document.getElementById("rouletteStatus").textContent = `Pari confirmé : ${betText} pour ${formatChips(stake)} €.`;
    document.getElementById("roulettePayout").textContent = "La roulette va tourner. Attention : le 00 apporte un avantage au casino.";
    showToast(`Pari de ${formatChips(stake)} € confirmé sur ${betText}.`);
  }

  function repeatBets() {
    if (state.wheelLocked || state.bets.length || !state.previousBets.length) return;
    const player = getPlayer();
    const limits = window.casinoGameSettings?.roulette || { minBet: 0.01, maxBet: 1_000_000 };
    if (state.previousBets.some(bet => bet.amount < limits.minBet || bet.amount > limits.maxBet)) {
      showToast("Les anciennes mises ne respectent plus les limites de la table.");
      return;
    }
    const total = state.previousBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (total > player.chips) {
      showToast(`Solde insuffisant pour répéter les mises : ${formatChips(total)} € nécessaires.`);
      return;
    }
    state.bets = state.previousBets.map(bet => ({ ...bet }));
    player.chips = roundMoney(player.chips - total);
    savePlayer(player);
    updateTopbar();
    renderBets();
    document.getElementById("rouletteStatus").textContent = `Mises répétées : ${state.bets.length} pari(s), ${formatChips(total)} €. Tu peux les modifier ou lancer la roulette.`;
    showToast(`Mises répétées pour ${formatChips(total)} €.`);
  }

  function spinWheel() {
    if (state.wheelLocked) {
      return;
    }

    if (!state.bets.length) {
      showToast("Aucun pari n'a été confirmé.");
      return;
    }

    const wheel = document.getElementById("rouletteWheel");
    const spinButton = document.getElementById("rouletteSpinBtn");
    const placeBetButton = document.getElementById("roulettePlaceBet");

    state.wheelLocked = true;
    renderBets();
    spinButton.disabled = true;
    placeBetButton.disabled = true;

    const stage = document.querySelector(".roulette-stage");
    const visibleStage = stage.hidden ? document.getElementById("rouletteRacetrack") : stage;
    visibleStage.scrollIntoView({ behavior: "smooth", block: "center" });

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
    animateTrackBall(winningIndex);

    setTimeout(() => settleSpin(winningNumber), 3000);
  }

  function settleSpin(winningNumber) {
    const player = getPlayer();
    const totalStake = roundMoney(state.bets.reduce((sum, bet) => sum + bet.amount, 0));
    const results = state.bets.map(bet => evaluateRouletteBet(bet, winningNumber));
    const payoutTotal = roundMoney(results.reduce((sum, result) => sum + result.payoutTotal, 0));
    const result = { won: payoutTotal > 0, payoutTotal, message: `${results.filter(result => result.won).length} pari(s) gagnant(s).` };

    if (result.won) {
      player.chips = roundMoney(player.chips + result.payoutTotal);
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
      labels: result.won ? `${formatChips(result.payoutTotal)} €` : "0"
    });
    state.lastResults = state.lastResults.slice(0, 10);

    document.getElementById("rouletteBallTrack").classList.remove("is-spinning");

    document.getElementById("rouletteStatus").textContent = `Le numéro gagnant est ${winningNumber}. ${result.message}`;
    document.getElementById("roulettePayout").textContent = `Mises : ${formatChips(totalStake)} € | Retour : ${formatChips(payoutTotal)} € | Bilan : ${formatChips(roundMoney(payoutTotal - totalStake))} €.`;

    addHistoryEntry({
      game: "roulette",
      bet: totalStake,
      result: result.won ? "Victoire" : "Défaite",
      payout: result.payoutTotal,
      net: roundMoney(result.payoutTotal - totalStake),
      date: new Date().toISOString(),
      number: winningNumber
    });

    renderHistory();
    renderHomeView();
    renderLeaderboard();
    renderFilteredHistory();

    state.previousBets = state.bets.map(bet => ({ ...bet }));
    state.bets = [];
    state.wheelLocked = false;
    renderBets();
    document.getElementById("rouletteSpinBtn").disabled = true;
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
      payoutTotal: roundMoney(payout),
      message: won
        ? `Bravo ! La bille s'est arrêtée sur ${winningNumber}. Ton pari ${getBetLabel(bet.type, bet.exactNumber)} est gagnant.`
        : `La bille s'est arrêtée sur ${winningNumber}. Ton pari ${getBetLabel(bet.type, bet.exactNumber)} n'a pas été touché.`,
      number: winningNumber
    };
  }

  function renderRacetrack() {
    const track = document.getElementById("rouletteRacetrackNumbers");
    track.replaceChildren();
    const center = document.createElement("div");
    center.className = "racetrack-center";
    center.textContent = "ROULETTE AMÉRICAINE · 0 / 00";
    track.appendChild(center);
    wheelNumbers.forEach((number, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `board-cell board-${getRouletteColor(number)} track-number`;
      button.dataset.boardNumber = number;
      button.dataset.trackIndex = String(index);
      button.textContent = number;
      // Sixteen pockets on each straight and three on each rounded end.
      if (index < 16 || (index >= 19 && index < 35)) {
        const upper = index < 16;
        const position = upper ? index : 34 - index;
        button.style.left = `${10 + position * 5}%`;
        button.style.top = upper ? "0" : "70%";
        button.style.width = "5%";
        button.style.height = "30%";
      } else {
        const right = index < 19;
        const segment = right ? index - 16 : index - 35;
        const start = (right ? -90 : 90) + segment * 60;
        const arc = (radius, reverse) => Array.from({ length: 13 }, (_, step) => {
          const angle = (start + (reverse ? 12 - step : step) * 5) * Math.PI / 180;
          return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)];
        });
        const points = [...arc(50, false), ...arc(20, true)];
        button.style.left = right ? "80%" : "0";
        button.style.top = "0";
        button.style.width = "20%";
        button.style.height = "100%";
        button.style.clipPath = `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(",")})`;
        const angle = (start + 30) * Math.PI / 180;
        const label = document.createElement("span");
        label.textContent = number;
        label.style.left = `${50 + 35 * Math.cos(angle)}%`;
        label.style.top = `${50 + 35 * Math.sin(angle)}%`;
        button.replaceChildren(label);
        button.classList.add("track-end");
      }
      button.addEventListener("click", () => placeBet("exact", number));
      track.appendChild(button);
    });
    const ns = "http://www.w3.org/2000/svg";
    const lines = document.createElementNS(ns, "svg");
    lines.setAttribute("viewBox", "0 0 1000 200");
    lines.setAttribute("aria-hidden", "true");
    lines.classList.add("track-lines");
    let path = "M100 2H900 A98 98 0 0 1 900 198 H100 A98 98 0 0 1 100 2 M100 60H900 A40 40 0 0 1 900 140 H100 A40 40 0 0 1 100 60";
    for (let i = 0; i <= 16; i++) {
      const x = 100 + i * 50;
      path += ` M${x} 0V60 M${x} 140V200`;
    }
    for (const cx of [100, 900]) {
      for (const angle of cx === 900 ? [-30, 30] : [150, 210]) {
        const radians = angle * Math.PI / 180;
        path += ` M${cx + 40 * Math.cos(radians)} ${100 + 40 * Math.sin(radians)} L${cx + 100 * Math.cos(radians)} ${100 + 100 * Math.sin(radians)}`;
      }
    }
    const outline = document.createElementNS(ns, "path");
    outline.setAttribute("d", path);
    lines.appendChild(outline);
    track.appendChild(lines);
    const ball = document.createElement("div");
    ball.id = "rouletteTrackBall";
    ball.className = "roulette-track-ball";
    ball.hidden = true;
    ball.setAttribute("aria-hidden", "true");
    track.appendChild(ball);
  }

  function getTrackPoint(position) {
    const pocket = ((position + 0.5) % 38 + 38) % 38;
    if (pocket < 16) return { left: 10 + pocket * 5, top: 15 };
    if (pocket >= 19 && pocket < 35) return { left: 90 - (pocket - 19) * 5, top: 85 };
    const right = pocket < 19;
    const angle = ((right ? -90 : 90) + (pocket - (right ? 16 : 35)) * 60) * Math.PI / 180;
    return { left: (right ? 90 : 10) + 7 * Math.cos(angle), top: 50 + 35 * Math.sin(angle) };
  }

  function animateTrackBall(winningIndex) {
    const ball = document.getElementById("rouletteTrackBall");
    const distance = 38 * 3 + (winningIndex - state.trackPosition + 38) % 38;
    const frames = Array.from({ length: 301 }, (_, index) => {
      const point = getTrackPoint(state.trackPosition + distance * index / 300);
      return { left: `${point.left}%`, top: `${point.top}%`, offset: index / 300 };
    });
    ball.hidden = false;
    ball.style.left = frames[300].left;
    ball.style.top = frames[300].top;
    ball.animate(frames, { duration: 3000, easing: "cubic-bezier(0.12, 0.82, 0.18, 1)" });
    state.trackPosition = winningIndex;
  }

  function renderBets() {
    const container = document.getElementById("rouletteBets");
    container.replaceChildren();
    state.bets.forEach((bet, index) => {
      const row = document.createElement("div");
      row.className = "roulette-bet-row";
      const label = document.createElement("span");
      label.textContent = `${getBetLabel(bet.type, bet.exactNumber)} : ${formatChips(bet.amount)} €`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-button";
      remove.textContent = "Retirer";
      remove.setAttribute("aria-label", `Retirer ${label.textContent}`);
      remove.disabled = state.wheelLocked;
      remove.addEventListener("click", () => {
        if (state.wheelLocked) return;
        const player = getPlayer();
        player.chips = roundMoney(player.chips + bet.amount);
        savePlayer(player);
        updateTopbar();
        state.bets.splice(index, 1);
        renderBets();
      });
      row.append(label, remove);
      container.appendChild(row);
    });
    document.getElementById("rouletteBetTotal").textContent = `Total misé : ${formatChips(state.bets.reduce((sum, bet) => sum + bet.amount, 0))} €`;
    document.querySelectorAll(".board-cell[data-board-number]").forEach(cell => {
      const amount = state.bets.filter(bet => bet.type === "exact" && String(bet.exactNumber) === cell.dataset.boardNumber).reduce((sum, bet) => sum + bet.amount, 0);
      cell.classList.toggle("active", amount > 0);
      cell.disabled = state.wheelLocked;
      cell.betMarker?.remove();
      cell.betMarker = null;
      cell.setAttribute("aria-label", `Numéro ${cell.dataset.boardNumber}, ${amount} € misés`);
      if (amount) {
        const marker = document.createElement("small");
        marker.className = "bet-marker";
        marker.textContent = amount;
        if (cell.dataset.trackIndex !== undefined) {
          // Keep badges outside the clipped end pockets so the full stake is visible.
          const point = getTrackPoint(Number(cell.dataset.trackIndex));
          marker.className += " track-bet-marker";
          marker.style.left = `${point.left}%`;
          marker.style.top = `${point.top + 7}%`;
          document.getElementById("rouletteRacetrackNumbers").appendChild(marker);
        } else {
          cell.appendChild(marker);
        }
        cell.betMarker = marker;
      }
    });
    document.getElementById("rouletteSpinBtn").disabled = state.wheelLocked || !state.bets.length;
    const repeatButton = document.getElementById("rouletteRepeatBet");
    repeatButton.disabled = state.wheelLocked || state.bets.length > 0 || !state.previousBets.length;
    const previousTotal = state.previousBets.reduce((sum, bet) => sum + bet.amount, 0);
    repeatButton.textContent = previousTotal ? `Répéter les mises (${previousTotal} €)` : "Répéter les mises";
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
