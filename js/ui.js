(function () {
  let pauseOverlay;
  let restartOverlay;
  let debugPanel;
  let audioButton;
  let hudHealthFill;
  let hudXpFill;
  let hudHealthValue;
  let hudXpValue;
  let hudFloor;
  let hudLevelValue;
  let damageFlash;
  let damageFlashValue;
  let damageTimeout;

  const listeners = {
    resume: null,
    restart: null,
    confirmRestart: null,
    toggleAudio: null
  };

  function initUI(opts) {
    pauseOverlay = document.getElementById("pause-overlay");
    restartOverlay = document.getElementById("restart-confirm");
    debugPanel = document.getElementById("debug-panel");
    audioButton = document.getElementById("btn-audio");
    hudHealthFill = document.getElementById("hud-health-fill");
    hudXpFill = document.getElementById("hud-xp-fill");
    hudHealthValue = document.getElementById("hud-health-value");
    hudXpValue = document.getElementById("hud-xp-value");
    hudFloor = document.getElementById("hud-floor");
    hudLevelValue = document.getElementById("hud-level-value");
    damageFlash = document.getElementById("damage-flash");
    damageFlashValue = document.getElementById("damage-flash-value");

    listeners.resume = opts.onResume;
    listeners.restart = opts.onRestart;
    listeners.confirmRestart = opts.onConfirmRestart;
    listeners.toggleAudio = opts.onToggleAudio;

    document.getElementById("btn-resume").addEventListener("click", () => {
      listeners.resume && listeners.resume();
    });

    document.getElementById("btn-restart").addEventListener("click", () => {
      listeners.restart && listeners.restart();
    });

    document.getElementById("btn-confirm-restart").addEventListener("click", () => {
      listeners.confirmRestart && listeners.confirmRestart(true);
    });

    document.getElementById("btn-cancel-restart").addEventListener("click", () => {
      listeners.confirmRestart && listeners.confirmRestart(false);
    });

    audioButton.addEventListener("click", () => {
      if (listeners.toggleAudio) {
        listeners.toggleAudio();
      }
    });
  }

  function updateHUD({ hp, hpMax, xp, xpMax, floor, keys, level }) {
    const hpPercent = hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 0;
    const xpPercent = xpMax > 0 ? Math.max(0, Math.min(1, xp / xpMax)) : 0;
    hudHealthFill.style.width = `${hpPercent * 100}%`;
    hudXpFill.style.width = `${xpPercent * 100}%`;
    hudHealthValue.textContent = `${hp} / ${hpMax}`;
    hudXpValue.textContent = `${xp} / ${xpMax}`;
    hudFloor.textContent = `Floor ${floor} / 100 | Keys ${keys}`;
    if (hudLevelValue) {
      hudLevelValue.textContent = `Level ${level}`;
    }
  }

  function flashDamage(amount) {
    if (!damageFlash || !damageFlashValue) {
      return;
    }
    damageFlashValue.textContent = amount ? `-${amount}` : "";
    damageFlash.classList.remove("active");
    // Force reflow so the animation retriggers even on rapid hits.
    void damageFlash.offsetWidth;
    damageFlash.classList.add("active");
    if (damageTimeout) {
      clearTimeout(damageTimeout);
    }
    damageTimeout = setTimeout(() => {
      damageFlash.classList.remove("active");
      damageFlashValue.textContent = "";
    }, 300);
  }

  function setPauseVisible(isVisible) {
    if (!pauseOverlay) return;
    pauseOverlay.classList.toggle("hidden", !isVisible);
  }

  function showRestartConfirm() {
    restartOverlay.classList.remove("hidden");
  }

  function hideRestartConfirm() {
    restartOverlay.classList.add("hidden");
  }

  function setDebug(text) {
    debugPanel.textContent = text;
  }

  function setDebugVisible(isVisible) {
    debugPanel.classList.toggle("hidden", !isVisible);
  }

  function setAudioMuted(isMuted) {
    audioButton.classList.toggle("muted", isMuted);
    audioButton.textContent = isMuted ? "Audio Off" : "Audio On";
  }

  window.UI = {
    init: initUI,
    updateHUD,
    setPauseVisible,
    showRestartConfirm,
    hideRestartConfirm,
    setDebug,
    setDebugVisible,
    setAudioMuted,
    flashDamage
  };
})();
