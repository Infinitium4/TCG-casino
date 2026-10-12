const slotsModule = (() => {
  const state = {
    spinning: false,
    lastSymbols: ["🍒", "🍋", "🔔"]
  };

  function initialize() {
    const spinButton = document.getElementById("slotsSpinBtn");
    const betInput = document.getElementById("slotsStake");
    spinButton.addEventListener("click", spinSlots);
    betInput.addEventListener("input", updateSlotsHud);

    document.getElementById("slotsPayoutTable").innerHTML = [
      "Trois cerises : 2x",
      "Trois citrons : 3x",
      "Trois cloches : 5x",
      "Trois diamants : 10x",
      "Trois sept rouges : 20x",
      "Trois jokers : 50x",
      "Deux identiques adjacents : 1x"
    ]
      .map((row) => `<li><span>${row.split(":")[0]}</span><strong>${row.split(":")[1]}</strong></li>`)
      .join("");

    updateSlotsHud();
  }

  function updateSlotsHud() {
    const player = getPlayer();
    const input = document.getElementById("slotsStake");
    document.getElementById("slotsStatus").textContent = `Solde : ${formatChips(player.chips)} • Mise actuelle : ${input.value || 0}`;
  }

  function spinSlots() {
    if (state.spinning) {
      return;
    }

    const player = getPlayer();
    const bet = Number(document.getElementById("slotsStake").value);

    if (!Number.isFinite(bet) || bet <= 0 || !Number.isInteger(bet)) {
      showToast("La mise de la machine à sous doit être un nombre entier positif.");
      return;
    }

    if (bet > player.chips) {
      showToast("Tu n'as pas assez de jetons pour cette mise.");
      return;
    }

    state.spinning = true;
    document.getElementById("slotsSpinBtn").disabled = true;
    document.getElementById("slotsStatus").textContent = "Les rouleaux tournent...";

    const reels = document.querySelectorAll(".reel");
    reels.forEach((reel) => {
      reel.classList.add("spinning");
    });

    const result = [
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)],
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)],
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)]
    ];

    setTimeout(() => {
      state.lastSymbols = result.map((entry) => entry.symbol);
      reels.forEach((reel, index) => {
        reel.classList.remove("spinning");
        reel.innerHTML = `<span class="slot-symbol">${result[index].symbol}</span>`;
      });

      const outcome = evaluateSlots(result, bet);
      const updatedPlayer = getPlayer();
      updatedPlayer.chips -= bet;
      updatedPlayer.chips += outcome.payoutTotal;

      updatedPlayer.stats.gamesPlayed = Number(updatedPlayer.stats.gamesPlayed || 0) + 1;
      if (outcome.payoutTotal > 0) {
        updatedPlayer.stats.wins = Number(updatedPlayer.stats.wins || 0) + 1;
      }
      updatedPlayer.stats.bestWin = Math.max(Number(updatedPlayer.stats.bestWin || 0), outcome.payoutTotal);
      updatedPlayer.stats.lastPlayed = new Date().toISOString();

      savePlayer(updatedPlayer);
      updateTopbar();
      renderHomeView();
      renderLeaderboard();
      renderProfileView();

      addHistoryEntry({
        game: "slots",
        bet,
        result: outcome.payoutTotal > 0 ? "Victoire" : "Défaite",
        payout: outcome.payoutTotal,
        net: outcome.payoutTotal - bet,
        date: new Date().toISOString()
      });

      document.getElementById("slotsStatus").textContent = outcome.message;
      document.getElementById("slotsSpinBtn").disabled = false;
      state.spinning = false;
      updateSlotsHud();
    }, 1200);
  }

  function evaluateSlots(resultArray, bet) {
    const [first, second, third] = resultArray;

    if (first.name === second.name && second.name === third.name) {
      const payoutTotal = bet * first.payout;
      return {
        payoutTotal,
        message: `Jackpot ! ${first.name} x3 : ${payoutTotal} jetons.`
      };
    }

    if (first.name === second.name || second.name === third.name) {
      return {
        payoutTotal: bet,
        message: `Deux symboles identiques adjacents : remboursement total de ${bet} jetons.`
      };
    }

    return {
      payoutTotal: 0,
      message: `Aucun gain. Tu as perdu ${bet} jetons.`
    };
  }

  window.slotsModule = { initialize };
  return { initialize };
})();
