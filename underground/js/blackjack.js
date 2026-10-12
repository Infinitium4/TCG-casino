const blackjackModule = (() => {
  const state = {
    deck: [],
    dealerCards: [],
    playerCards: [],
    currentBet: 0,
    roundActive: false,
    playerTurn: false,
    dealerRevealed: false
  };

  function initialize() {
    document.getElementById("blackjackDealBtn").addEventListener("click", startRound);
    document.getElementById("blackjackHitBtn").addEventListener("click", hitCard);
    document.getElementById("blackjackStandBtn").addEventListener("click", stand);
    document.getElementById("blackjackStake").addEventListener("input", updateBlackjackHud);
    resetBoard();
  }

  function updateBlackjackHud() {
    const player = getPlayer();
    document.getElementById("blackjackBalance").textContent = formatChips(player.chips);
    document.getElementById("blackjackBet").textContent = formatChips(Number(document.getElementById("blackjackStake").value || 0));
  }

  function resetBoard() {
    state.deck = [];
    state.dealerCards = [];
    state.playerCards = [];
    state.currentBet = 0;
    state.roundActive = false;
    state.playerTurn = false;
    state.dealerRevealed = false;
    document.getElementById("dealerCards").innerHTML = "";
    document.getElementById("playerCards").innerHTML = "";
    document.getElementById("dealerTotal").textContent = "0";
    document.getElementById("playerTotal").textContent = "0";
    document.getElementById("blackjackStatus").textContent = "Choisis une mise et commence une manche.";
    document.getElementById("blackjackHitBtn").disabled = true;
    document.getElementById("blackjackStandBtn").disabled = true;
    updateBlackjackHud();
  }

  function startRound() {
    const player = getPlayer();
    const stake = Number(document.getElementById("blackjackStake").value);

    if (!Number.isFinite(stake) || stake <= 0 || !Number.isInteger(stake)) {
      showToast("La mise du blackjack doit être un entier positif.");
      return;
    }

    if (stake > player.chips) {
      showToast("Tu n'as pas assez de jetons pour cette mise.");
      return;
    }

    if (state.roundActive) {
      return;
    }

    player.chips -= stake;
    savePlayer(player);
    updateTopbar();
    updateBlackjackHud();

    state.currentBet = stake;
    state.roundActive = true;
    state.playerTurn = true;
    state.dealerRevealed = false;
    state.deck = shuffleDeck(buildDeck());
    state.dealerCards = [drawCard(), drawCard()];
    state.playerCards = [drawCard(), drawCard()];

    document.getElementById("blackjackHitBtn").disabled = false;
    document.getElementById("blackjackStandBtn").disabled = false;

    renderHands();

    if (checkInitialBlackjacks()) {
      return;
    }

    document.getElementById("blackjackStatus").textContent = "Ton tour. Choisis de tirer ou de rester.";
  }

  function drawCard() {
    return state.deck.pop();
  }

  function hitCard() {
    if (!state.roundActive || !state.playerTurn) {
      return;
    }

    state.playerCards.push(drawCard());
    const playerTotal = calculateHandValue(state.playerCards).total;
    renderHands();

    if (playerTotal > 21) {
      finishRound("loss", "Tu as dépassé 21. La main est perdue.");
      return;
    }

    if (playerTotal === 21) {
      stand();
      return;
    }

    document.getElementById("blackjackStatus").textContent = "Tu as tiré une carte. Décide encore de rester ou de prendre une autre.";
  }

  function stand() {
    if (!state.roundActive || !state.playerTurn) {
      return;
    }

    state.playerTurn = false;
    state.dealerRevealed = true;
    const dealerTotal = calculateHandValue(state.dealerCards).total;

    while (dealerTotal < 17) {
      state.dealerCards.push(drawCard());
      const nextTotal = calculateHandValue(state.dealerCards).total;
      if (nextTotal > 21) {
        break;
      }
    }

    renderHands();

    const playerTotal = calculateHandValue(state.playerCards).total;
    const newDealerTotal = calculateHandValue(state.dealerCards).total;

    if (newDealerTotal > 21) {
      finishRound("win", "Le croupier a dépassé 21. Tu gagnes.");
      return;
    }

    if (playerTotal > newDealerTotal) {
      finishRound("win", "Tu as le meilleur score. Victoire.");
      return;
    }

    if (playerTotal < newDealerTotal) {
      finishRound("loss", "Le croupier a le meilleur score. Défaite.");
      return;
    }

    finishRound("push", "Égalité. La mise est rendue.");
  }

  function checkInitialBlackjacks() {
    const playerScore = calculateHandValue(state.playerCards).total;
    const dealerScore = calculateHandValue(state.dealerCards).total;

    if (playerScore === 21 && dealerScore === 21) {
      finishRound("push", "Les deux mains possèdent un blackjack naturel. Égalité.");
      return true;
    }

    if (playerScore === 21) {
      finishRound("blackjack", "Blackjack naturel ! Tu gagnes 2,5 fois la mise.");
      return true;
    }

    if (dealerScore === 21) {
      finishRound("loss", "Le croupier a un blackjack naturel. Défaite.");
      return true;
    }

    return false;
  }

  function finishRound(result, message) {
    const player = getPlayer();
    let payoutTotal = 0;
    let finalResult = "Défaite";

    if (result === "win") {
      payoutTotal = state.currentBet * 2;
      finalResult = "Victoire";
    } else if (result === "blackjack") {
      payoutTotal = state.currentBet * 2.5;
      finalResult = "Blackjack";
    } else if (result === "push") {
      payoutTotal = state.currentBet;
      finalResult = "Égalité";
    }

    if (payoutTotal > 0) {
      player.chips += payoutTotal;
    }

    player.stats.gamesPlayed = Number(player.stats.gamesPlayed || 0) + 1;
    if (result === "win" || result === "blackjack") {
      player.stats.wins = Number(player.stats.wins || 0) + 1;
    }
    player.stats.bestWin = Math.max(Number(player.stats.bestWin || 0), payoutTotal);
    player.stats.lastPlayed = new Date().toISOString();
    savePlayer(player);
    updateTopbar();
    updateBlackjackHud();
    renderHomeView();
    renderLeaderboard();
    renderProfileView();

    addHistoryEntry({
      game: "blackjack",
      bet: state.currentBet,
      result: finalResult,
      payout: payoutTotal,
      net: payoutTotal - state.currentBet,
      date: new Date().toISOString()
    });

    state.roundActive = false;
    state.playerTurn = false;
    state.dealerRevealed = true;
    document.getElementById("blackjackHitBtn").disabled = true;
    document.getElementById("blackjackStandBtn").disabled = true;
    renderHands();
    document.getElementById("blackjackStatus").textContent = `${message} ${result === "push" ? "La mise est rendue." : `Payout total : ${payoutTotal} jetons.`}`;
  }

  function renderHands() {
    const dealerCards = document.getElementById("dealerCards");
    const playerCards = document.getElementById("playerCards");
    const dealerTotal = calculateHandValue(state.dealerCards).total;
    const playerTotal = calculateHandValue(state.playerCards).total;

    document.getElementById("dealerTotal").textContent = state.dealerRevealed || !state.roundActive ? String(dealerTotal) : "?";
    document.getElementById("playerTotal").textContent = String(playerTotal);

    dealerCards.innerHTML = state.dealerCards
      .map((card, index) => {
        const hidden = !state.dealerRevealed && state.roundActive && index === 1;
        return renderCard(card, hidden);
      })
      .join("");

    playerCards.innerHTML = state.playerCards.map((card) => renderCard(card)).join("");
  }

  function renderCard(card, hidden = false) {
    if (hidden) {
      return '<div class="card back">?</div>';
    }

    const suitDisplay = card.suit;
    const symbol = card.color === "red" ? "red" : "black";
    return `<div class="card ${symbol}"><span>${card.label}</span><span>${suitDisplay}</span></div>`;
  }

  window.blackjackModule = { initialize };
  return { initialize };
})();
