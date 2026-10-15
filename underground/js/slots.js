const slotsModule = (() => {
  const state = {
    spinning: false,
    lastSymbols: ["🍒", "🍋", "🔔"]
  };

  function initialize() {
    const leverButton = document.getElementById("slotsLever");
    const betInput = document.getElementById("slotsStake");
    leverButton.addEventListener("click", spinSlots);
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
    setSlotsResult("ready", "Prêt à jouer", "Choisis ta mise puis lance les rouleaux.");
  }

  function updateSlotsHud() {
    const player = getPlayer();
    const input = document.getElementById("slotsStake");
    document.getElementById("slotsHud").textContent = `Solde : ${formatChips(player.chips)} € · Mise : ${input.value || 0} €`;
  }

  function setSlotsResult(stateName, title, message) {
    const resultPanel = document.getElementById("slotsStatus");
    resultPanel.dataset.result = stateName;
    document.getElementById("slotsResultTitle").textContent = title;
    document.getElementById("slotsResultMessage").textContent = message;
  }

  function setLeverPulled(leverButton, pulled) {
    const leverArm = leverButton.querySelector(".lever-arm");
    leverButton.classList.toggle("is-pulled", pulled);
    leverArm.getAnimations().forEach((animation) => animation.cancel());

    const compactLever = window.matchMedia("(max-width: 680px)").matches;
    const restTransform = "translateX(-50%) rotate(-14deg)";
    const pulledTransform = compactLever
      ? "translateX(-50%) rotate(22deg) translateY(28px)"
      : "translateX(-50%) rotate(65deg)";
    const overshootTransform = compactLever
      ? "translateX(-50%) rotate(28deg) translateY(34px)"
      : "translateX(-50%) rotate(72deg)";
    const duration = pulled ? 460 : 360;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      leverArm.style.transform = pulled ? pulledTransform : restTransform;
      return 0;
    }

    const keyframes = pulled
      ? [
          { transform: restTransform, offset: 0 },
          { transform: overshootTransform, offset: 0.72 },
          { transform: pulledTransform, offset: 1 }
        ]
      : [
          { transform: pulledTransform, offset: 0 },
          { transform: "translateX(-50%) rotate(-20deg)", offset: 0.68 },
          { transform: restTransform, offset: 1 }
        ];
    const animation = leverArm.animate(keyframes, {
      duration,
      easing: "cubic-bezier(0.2, 0.76, 0.24, 1)",
      fill: "forwards"
    });

    animation.onfinish = () => {
      leverArm.style.transform = pulled ? pulledTransform : restTransform;
      animation.cancel();
    };

    return duration;
  }

  function spinSlots() {
    if (state.spinning) {
      return;
    }

    const player = getPlayer();
    const bet = Number(document.getElementById("slotsStake").value);
    const limits = window.casinoGameSettings?.slots || { minBet: 0.01, maxBet: 1_000_000 };

    if (!Number.isFinite(bet) || bet < limits.minBet || bet > limits.maxBet || !isMoney(bet)) {
      showToast(`La mise doit être comprise entre ${limits.minBet} et ${limits.maxBet} €.`);
      return;
    }

    if (bet > player.chips) {
      showToast("Tu n'as pas assez de € pour cette mise.");
      return;
    }

    state.spinning = true;
    player.chips = roundMoney(player.chips - bet);
    savePlayer(player);
    updateTopbar();
    updateSlotsHud();
    const leverButton = document.getElementById("slotsLever");
    const machine = document.querySelector(".slots-machine");
    leverButton.disabled = true;
    setLeverPulled(leverButton, true);
    machine.classList.add("is-spinning");
    setSlotsResult("spinning", "Ça tourne…", "Les rouleaux s'arrêtent un par un.");

    const reels = [...document.querySelectorAll(".reel")];
    const result = [
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)],
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)],
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)]
    ];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stopDelays = reducedMotion ? [120, 240, 360] : [2200, 2850, 3500];
    const tracks = reels.map((reel, index) => {
      reel.classList.add("spinning");
      reel.classList.remove("stopped");
      return buildReelTrack(reel, result[index].symbol, stopDelays[index], reducedMotion);
    });

    reels.forEach((reel, index) => {
      window.setTimeout(() => {
        const { track, finalOffset } = tracks[index];
        track.getAnimations().forEach((animation) => animation.cancel());
        track.style.transform = `translateY(-${finalOffset}px)`;
        reel.classList.remove("spinning");
        reel.classList.add("stopped");
        track.querySelector(".is-result").classList.add("is-landed");

        if (index === reels.length - 1) {
          state.lastSymbols = result.map((entry) => entry.symbol);
          machine.classList.remove("is-spinning");
          settleSlots(result, bet);
        }
      }, stopDelays[index]);
    });
  }

  function buildReelTrack(reel, resultSymbol, duration, reducedMotion) {
    const resultIndex = 24;
    const tileHeight = reel.clientHeight / 3;
    const symbols = Array.from({ length: resultIndex + 3 }, () => (
      SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)].symbol
    ));
    symbols[resultIndex] = resultSymbol;

    const track = document.createElement("div");
    track.className = "reel-track";
    track.style.setProperty("--reel-cell-height", `${tileHeight}px`);
    track.innerHTML = symbols.map((symbol, index) => `
      <span class="reel-tile${index === resultIndex ? " is-result" : ""}">
        <span class="slot-symbol">${symbol}</span>
      </span>
    `).join("");
    reel.replaceChildren(track);
    track.style.transform = "translateY(0)";
    const finalOffset = (resultIndex - 1) * tileHeight;

    if (reducedMotion) {
      track.style.transform = `translateY(-${finalOffset}px)`;
    } else {
      track.animate(
        [
          { transform: "translateY(0)" },
          { transform: `translateY(-${finalOffset}px)` }
        ],
        {
          duration,
          easing: "cubic-bezier(0.08, 0.68, 0.12, 1)",
          fill: "forwards"
        }
      );
    }

    return { track, finalOffset };
  }

  function settleSlots(result, bet) {
    const outcome = evaluateSlots(result, bet);
    const net = roundMoney(outcome.payoutTotal - bet);
    const resultState = net > 0 ? "win" : net === 0 ? "refund" : "loss";
    const resultTitle = resultState === "win"
      ? `GAGNÉ · +${formatChips(net)} €`
      : resultState === "refund"
        ? "MISE REMBOURSÉE"
        : `PERDU · -${formatChips(bet)} €`;
    const updatedPlayer = getPlayer();
    updatedPlayer.chips = roundMoney(updatedPlayer.chips + outcome.payoutTotal);

    updatedPlayer.stats.gamesPlayed = Number(updatedPlayer.stats.gamesPlayed || 0) + 1;
    if (resultState === "win") {
      updatedPlayer.stats.wins = Number(updatedPlayer.stats.wins || 0) + 1;
    }
    updatedPlayer.stats.bestWin = Math.max(Number(updatedPlayer.stats.bestWin || 0), outcome.payoutTotal);
    updatedPlayer.stats.lastPlayed = new Date().toISOString();

    savePlayer(updatedPlayer);
    updateTopbar();

    addHistoryEntry({
      game: "slots",
      bet,
      result: resultState === "win" ? "Victoire" : resultState === "refund" ? "Remboursement" : "Défaite",
      payout: outcome.payoutTotal,
      net,
      date: new Date().toISOString()
    });

    renderHomeView();
    renderLeaderboard();
    renderProfileView();
    setSlotsResult(resultState, resultTitle, outcome.message);
    const leverButton = document.getElementById("slotsLever");
    const releaseDuration = setLeverPulled(leverButton, false);
    window.setTimeout(() => {
      leverButton.disabled = false;
    }, releaseDuration);
    state.spinning = false;
    updateSlotsHud();
  }

  function evaluateSlots(resultArray, bet) {
    const [first, second, third] = resultArray;

    if (first.name === second.name && second.name === third.name) {
      const payoutTotal = moneyRatio(bet, first.payout, 1);
      return {
        payoutTotal,
        message: `Jackpot ! ${first.name} x3 : ${payoutTotal} €.`
      };
    }

    if (first.name === second.name || second.name === third.name) {
      return {
        payoutTotal: bet,
        message: `Deux symboles identiques adjacents : remboursement total de ${formatChips(bet)} €.`
      };
    }

    return {
      payoutTotal: 0,
      message: `Aucun gain. Tu as perdu ${formatChips(bet)} €.`
    };
  }

  window.slotsModule = { initialize };
  return { initialize };
})();
